const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function generateCtrlNumber() {
  return crypto.randomBytes(16).toString("base64").replace(/[+/=]/g, "").slice(0, 22);
}

function formatTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " ",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function formatFileTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function formatDateHHMM(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " ",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function formatDate2300(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " 230000",
  ].join("");
}

function addDays(date, days) {
  const output = new Date(date.getTime());
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function buildAsnFeedXml({ asn, po, sku, skuQty, now }) {
  const ctrlTrans = generateCtrlNumber();
  const ctrlGroup = generateCtrlNumber();
  const ctrlTxn = generateCtrlNumber();
  const transmissionTimestamp = formatTimestamp(now);
  const bsnDate = formatDateHHMM(now);
  const date579 = formatDate2300(addDays(now, 15));
  const dateAgFrst = formatDate2300(addDays(now, 25));
  const date274 = formatDate2300(addDays(now, 16));

  // Parse comma-separated SKUs and quantities
  const skus = sku.split(",").map(s => s.trim());
  const quantities = skuQty.split(",").map(q => q.trim());

  // Build LineItem elements for each SKU
  const lineItems = skus
    .map((skuValue, index) => {
      const qty = quantities[index] || quantities[0] || "1";
      return `              <LineItem Key="${skuValue}">
                <Attribute AttributeTypeCd="SK">${skuValue}</Attribute>
                <Measure Qualifier="SN102" SourceUOMCd="355" UOMCd="UN">${qty}</Measure>
              </LineItem>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<XMLBundle>
  <XMLTransmission CtrlNumber="${ctrlTrans}" Receiver="E2ASOS" Sender="ASOS" Timestamp="${transmissionTimestamp}">
    <XMLGroup CtrlNumber="${ctrlGroup}" GroupType="BP" IncludedMessages="1">
      <XMLTransaction CtrlNumber="${ctrlTxn}" TransactionType="BPM-856">
        <BpMessage MessageType="856" PurposeCd="04">
          <Mode>30</Mode>
          <Reference RefTypeCd="SHTYPE" SourceRefTypeCd="128">ASN</Reference>
          <Reference RefTypeCd="SACHL" SourceRefTypeCd="128">R</Reference>
          <Reference RefTypeCd="WHFLG" SourceRefTypeCd="128">N</Reference>
          <Reference RefTypeCd="ASNTYPE" SourceRefTypeCd="128">SPEED TO MARKET</Reference>
          <Reference RefTypeCd="PSCORE" SourceRefTypeCd="128">-1</Reference>
          <Date TimeZone="UT" DateTypeCd="BSN03">${bsnDate}</Date>
          <Date TimeZone="UT" DateTypeCd="579">${date579}</Date>
          <Date TimeZone="UT" DateTypeCd="AG_FRST">${dateAgFrst}</Date>
          <Date TimeZone="UT" DateTypeCd="274">${date274}</Date>
          <TradePartner RoleCd="FD">
            <TradePartnerName>FC01 Barnsley</TradePartnerName>
            <TradePartnerID Qualifier="93">FC01</TradePartnerID>
            <TradePartnerAddress>
              <Street />
              <City>Barnsley</City>
              <StateProvinceCd />
              <PostalCd />
              <CountryCd>UK</CountryCd>
            </TradePartnerAddress>
          </TradePartner>
          <TradePartner RoleCd="FS">
            <TradePartnerName>FC01 Barnsley</TradePartnerName>
            <TradePartnerID Qualifier="93">FC01</TradePartnerID>
            <TradePartnerAddress>
              <Street />
              <City>Barnsley</City>
              <StateProvinceCd />
              <PostalCd />
              <CountryCd>UK</CountryCd>
            </TradePartnerAddress>
          </TradePartner>
          <Document DocType="SHIP" Key="${asn}">
            <DocumentID>${asn}</DocumentID>
            <Order Key="${po}" OrderType="PO">
              <OrderID>${po}</OrderID>
${lineItems}
            </Order>
          </Document>
        </BpMessage>
      </XMLTransaction>
    </XMLGroup>
  </XMLTransmission>
</XMLBundle>
`;
}

async function writeAsnFeedFile({ asn, po, sku, skuQty, outputDir }) {
  const now = new Date();
  const xmlContent = buildAsnFeedXml({ asn, po, sku, skuQty, now });

  const uuid = crypto.randomUUID();
  const fileTimestamp = formatFileTimestamp(now);
  const fileName = `ASOS_E2ASOS_ASN_ASN_${asn}_${uuid}_${fileTimestamp}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return { fileName, filePath, xmlContent };
}

module.exports = { buildAsnFeedXml, writeAsnFeedFile };

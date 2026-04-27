const path = require("path");
const fs = require("fs/promises");
const { getCarrierProfile } = require("./carrier-profile");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function formatCtrlTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
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

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("");
}

function formatDateMidnight(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    " 000000",
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

function addDays(date, days) {
  const output = new Date(date.getTime());
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

// Map carrier profile to PO CA values
function getPoCarrier(carrier) {
  const profile = getCarrierProfile(carrier);
  const caMap = {
    DT: { caName: "Davies Turner", caId: "3" },
    Maersk: { caName: "Maersk", caId: "12" },
    Advanced: { caName: "Advanced Processing", caId: "5" },
  };
  return caMap[profile.input] || caMap.DT;
}

function buildPoFeedXml({ po, sku, skuQty, optionId, carrier = "DT", now }) {
  const ctrlNumber = formatCtrlTimestamp(now);
  const transmissionTimestamp = formatTimestamp(now);
  const poCarrier = getPoCarrier(carrier);

  const date275 = formatDateMidnight(now);
  const date579 = formatDateOnly(addDays(now, 30));
  const date574 = formatDateOnly(addDays(now, 30));
  const date576 = formatDateOnly(addDays(now, 45));
  const date065 = formatDateOnly(addDays(now, 90));
  const date274 = formatDateOnly(addDays(now, 60));

  // Parse comma-separated SKUs and quantities
  const skus = sku.split(",").map(s => s.trim());
  const quantities = skuQty.split(",").map(q => q.trim());

  const lineItems = skus
    .map((skuValue, index) => {
      const qty = quantities[index] || quantities[0] || "1";
      return `<LineItem Key="${skuValue}">
<Attribute AttributeTypeCd="SK">${skuValue}</Attribute>
<Mode>30</Mode>
<Reference RefTypeCd="PT" SourceRefTypeCd="128">${optionId}</Reference>
<Reference RefTypeCd="VP" SourceRefTypeCd="128">TEST FOR REC</Reference>
<Price CurrencyCd="GBP" Qualifier="UCP">94.0500</Price>
<Price CurrencyCd="GBP" Qualifier="RTL">297.0000</Price>
<Measure Qualifier="PO102" SourceUOMCd="355" UOMCd="UN">${qty}</Measure>
</LineItem>`;
    })
    .join("\n");

  return `<?xml version='1.0' encoding='UTF-8'?>
<XMLBundle>
<XMLTransmission CtrlNumber="${ctrlNumber}" Receiver="E2ASOS" Sender="ASOS" Timestamp="${transmissionTimestamp}">
<XMLGroup CtrlNumber="${ctrlNumber}" GroupType="BP" IncludedMessages="1">
<XMLTransaction CtrlNumber="${po}" TransactionType="BPM-850">
<BpMessage MessageType="850" PurposeCd="05">
<Order Key="${po}" OrderType="PO">
<OrderID>${po}</OrderID>
<Reference RefTypeCd="8X" SourceRefTypeCd="128">D</Reference>
<Reference RefTypeCd="ACC" SourceRefTypeCd="128">A</Reference>
<Reference RefTypeCd="ID" SourceRefTypeCd="128">23084788</Reference>
<Reference RefTypeCd="SACHL" SourceRefTypeCd="128">R</Reference>
<Reference RefTypeCd="WHFLG" SourceRefTypeCd="128">N</Reference>
<Date DateTypeCd="275" TimeZone="UT">${date275}</Date>
<Date DateTypeCd="579" TimeZone="UT">${date579}</Date>
<Date DateTypeCd="574" TimeZone="UT">${date574}</Date>
<Date DateTypeCd="576" TimeZone="UT">${date576}</Date>
<Date DateTypeCd="065" TimeZone="UT">${date065}</Date>
<Date DateTypeCd="274" TimeZone="UT">${date274}</Date>
<FOBInstructions>
<TransTermsCd Qualifier="01">DDP</TransTermsCd>
</FOBInstructions>
<TradePartner RoleCd="CA">
<TradePartnerName>${poCarrier.caName}</TradePartnerName>
<TradePartnerID Qualifier="93">${poCarrier.caId}</TradePartnerID>
</TradePartner>
<TradePartner RoleCd="FD">
<TradePartnerName>FC01 Barnsley</TradePartnerName>
<TradePartnerID Qualifier="93">FC01</TradePartnerID>
</TradePartner>
<TradePartner RoleCd="F1">
<TradePartnerName>FC01 Barnsley</TradePartnerName>
<TradePartnerID Qualifier="93">FC01</TradePartnerID>
</TradePartner>
${lineItems}
</Order>
</BpMessage>
</XMLTransaction>
</XMLGroup>
</XMLTransmission>
</XMLBundle>
`;
}

let poCounter = 1;

async function writePoFeedFile({ po, sku, skuQty, optionId, carrier = "DT", outputDir }) {
  const now = new Date();
  const xmlContent = buildPoFeedXml({ po, sku, skuQty, optionId, carrier, now });
  const fileTimestamp = formatFileTimestamp(now);
  const counter = poCounter++;
  const fileName = `ASOS_E2ASOS_PO_PO_${po}_${counter}_${fileTimestamp}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return { fileName, filePath, xmlContent };
}

module.exports = { buildPoFeedXml, writePoFeedFile };

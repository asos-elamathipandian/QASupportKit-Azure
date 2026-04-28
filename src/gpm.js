const path = require("path");
const fs = require("fs/promises");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function formatFileTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function buildGpmXml({ sku, optionId }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ASOS_GPM_INBOUND_V2 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <INTEGRATION_MESSAGE_CONTROL>
    <ACTION>FULL_UPDATE</ACTION>
    <COMPANY_CODE>ASOS</COMPANY_CODE>
    <ORG_CODE>ASOS</ORG_CODE>
    <PRIORITY>5</PRIORITY>
    <MESSAGE_TYPE>INBOUND_ENTITY_INTEGRATION</MESSAGE_TYPE>
    <USERID>ASOS_ADMIN</USERID>
    <RECEIVER>E2ASOS</RECEIVER>
    <SENDER>ASOS</SENDER>
    <BUS_KEY>
      <ORG_CODE>ASOS</ORG_CODE>
      <PROD_ID>${sku}</PROD_ID>
    </BUS_KEY>
  </INTEGRATION_MESSAGE_CONTROL>
  <PRODUCT>
    <IS_ACTIVE>Y</IS_ACTIVE>
    <ORG_CODE>ASOS</ORG_CODE>
    <PROD_DESCRIPTION>Sku Publish1${sku}</PROD_DESCRIPTION>
    <PROD_ID>${sku}</PROD_ID>
    <SOURCE_PROD_ID>${sku}</SOURCE_PROD_ID>
    <SUPPLIER_COLOUR>MID BLUE</SUPPLIER_COLOUR>
    <BUYING_DIVISION_ID>11</BUYING_DIVISION_ID>
    <BUSINESS_MODEL>31</BUSINESS_MODEL>
    <BUSINESS_MODEL_DESC>Topshop</BUSINESS_MODEL_DESC>
    <BUYING_GROUP_ID>514</BUYING_GROUP_ID>
    <BUYING_SET_ID>BuyingSet0022000605140031</BUYING_SET_ID>
    <BUYING_SUBGROUP_ID>6</BUYING_SUBGROUP_ID>
    <COMPOSITION>Woven: Main: 100% Cotton.</COMPOSITION>
    <CONSTRUCTION>Woven</CONSTRUCTION>
    <DIVISION_ID>Division1</DIVISION_ID>
    <GENDER>Women's</GENDER>
    <MERCH_SEASON>AW24</MERCH_SEASON>
    <OPTION_ID>${optionId}</OPTION_ID>
    <PRIMARY_EAN></PRIMARY_EAN>
    <PRODUCT_GROUP_ID>31</PRODUCT_GROUP_ID>
    <PRODUCT_GRP_DESC>TOPSHOP</PRODUCT_GRP_DESC>
    <PRODUCT_TYPE>Jeans</PRODUCT_TYPE>
    <PROD_SIZE>W24L28</PROD_SIZE>
    <SUPPLIER_SKU_REFERENCE>${sku}</SUPPLIER_SKU_REFERENCE>
    <IS_HAZARDOUS>N/A</IS_HAZARDOUS>
    <SIZE_SEQUENCE_ID>10</SIZE_SEQUENCE_ID>
    <SIZE_DESC>W24L28</SIZE_DESC>
    <DIVISION_DESC>Womenswear</DIVISION_DESC>
    <BUYING_SUBGRP_DESC>Denim TS Petite</BUYING_SUBGRP_DESC>
    <BUYING_SET_DESC>Ember</BUYING_SET_DESC>
    <BUYING_GROUP_DESC>Denim TS</BUYING_GROUP_DESC>
    <BUYING_DIV_DESC>Topshop &amp; Topman</BUYING_DIV_DESC>
    <BRAND_NAME>Topshop</BRAND_NAME>
    <PROD_COLOR>MBLUE</PROD_COLOR>
    <COLOR_DESC>2003</COLOR_DESC>
    <PROD_STYLE>500929539</PROD_STYLE>
    <COUNTRY_OF_MANUFACTURE>TR</COUNTRY_OF_MANUFACTURE>
    <CTRY_COMMODITY>
      <CTRY_CODE>GB</CTRY_CODE>
      <COMMODITY_CODE>6204623190</COMMODITY_CODE>
    </CTRY_COMMODITY>
    <CTRY_COMMODITY>
      <CTRY_CODE>US</CTRY_CODE>
      <COMMODITY_CODE>6204628021</COMMODITY_CODE>
    </CTRY_COMMODITY>
    <CTRY_COMMODITY>
      <CTRY_CODE>01</CTRY_CODE>
      <COMMODITY_CODE>6204623190</COMMODITY_CODE>
    </CTRY_COMMODITY>
  </PRODUCT>
</ASOS_GPM_INBOUND_V2>
`;
}

async function writeGpmFile({ sku, optionId, outputDir }) {
  const skus = sku.split(",").map(s => s.trim()).filter(Boolean);
  const optionIds = optionId.split(",").map(s => s.trim()).filter(Boolean);
  const absoluteOutputDir = path.resolve(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  const results = [];
  for (let i = 0; i < skus.length; i++) {
    const singleSku = skus[i];
    const singleOption = optionIds[i] || optionIds[0] || "";
    const now = new Date();
    const xmlContent = buildGpmXml({ sku: singleSku, optionId: singleOption });
    const fileTimestamp = formatFileTimestamp(now);
    const fileName = `ASOS_E2ASOS_GPM_1.0_${singleSku}_${fileTimestamp}.xml`;
    const filePath = path.join(absoluteOutputDir, fileName);
    await fs.writeFile(filePath, xmlContent, "utf8");
    results.push({ fileName, filePath, xmlContent, sku: singleSku, optionId: singleOption });
  }

  // Return single-file shape when only one SKU, array when multiple
  if (results.length === 1) {
    return results[0];
  }
  return { files: results };
}

module.exports = { buildGpmXml, writeGpmFile };

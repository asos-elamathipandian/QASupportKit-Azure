const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function generateCtrlNumber() {
  // 22-char base64 string matching resource file pattern e.g. akiiRmBecUOgx9J1E3QjPg
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

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function buildAsnFcbkcXml({ asn, now }) {
  const ctrlNumber = generateCtrlNumber();
  const transmissionTimestamp = formatTimestamp(now);
  // Resource comment: Date can be current system time + 1 min
  const fcbkcDate = formatTimestamp(addSeconds(now, 2));

  return `<?xml version="1.0" encoding="utf-8"?>
<XMLBundle xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
\t<XMLTransmission CtrlNumber="${ctrlNumber}" Receiver="E2ASOS" Sender="ASOS" Timestamp="${transmissionTimestamp}" TimeZone="UT">
\t\t<XMLGroup CtrlNumber="${ctrlNumber}" GroupType="BP" IncludedMessages="1">
\t\t\t<XMLTransaction CtrlNumber="${asn}" TransactionType="BPM-856">
\t\t\t\t<BpMessage MessageType="856" PurposeCd="04">
\t\t\t\t\t<Reference RefTypeCd="SHTYPE" SourceRefTypeCd="128">ASN</Reference>
\t\t\t\t\t<Reference RefTypeCd="SACHL" SourceRefTypeCd="128">R</Reference>
\t\t\t\t\t<Date TimeZone="UT" DateTypeCd="FCBKC">${fcbkcDate}</Date>
\t\t\t\t\t<Document DocType="SHIP" Key="${asn}">
\t\t\t\t\t\t<DocumentID>${asn}</DocumentID>
\t\t\t\t\t</Document>
\t\t\t\t</BpMessage>
\t\t\t</XMLTransaction>
\t\t</XMLGroup>
\t</XMLTransmission>
</XMLBundle>
`;
}

async function writeAsnFcbkcFile({ asn, outputDir }) {
  const now = new Date();
  const xmlContent = buildAsnFcbkcXml({ asn, now });

  // File name matches resource format: ASOS_E2ASOS_ASN_ASN_{ASN}_{UUID}_{TIMESTAMP}.xml
  const uuid = crypto.randomUUID();
  const fileTimestamp = formatFileTimestamp(now);
  const fileName = `ASOS_E2ASOS_ASN_ASN_${asn}_${uuid}_${fileTimestamp}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return { fileName, filePath, xmlContent };
}

module.exports = { buildAsnFcbkcXml, writeAsnFcbkcFile };

const path = require("path");
const fs = require("fs/promises");

function pad(number, size = 2) {
  return String(number).padStart(size, "0");
}

function formatCtrlNumber(date) {
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

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function formatDateTime(date) {
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

function buildBulkStatusXml({ asn, now = new Date() }) {
  const ctrlNumber = formatCtrlNumber(now);
  const timestamp = formatTimestamp(now);
  const handoverDate = formatDateTime(addSeconds(now, 3));

  return `<XMLBundle>\n<XMLTransmission CtrlNumber="${ctrlNumber}" Receiver="E2ASOS" Sender="DAVIESTN" Timestamp="${timestamp}">\n<XMLGroup CtrlNumber="${ctrlNumber}" GroupType="BP" IncludedMessages="1">\n<XMLTransaction CtrlNumber="${asn}" TransactionType="BPM-BST">\n<BpMessage MessageType="BST">\n<Mode>30</Mode>\n<Status>\n<Date DateTypeCd="HNDOVR" TimeZone="UTC">${handoverDate}</Date>\n</Status>\n<Document DocType="SHIP" Key="${asn}">\n<DocumentID>${asn}</DocumentID>\n</Document>\n</BpMessage>\n</XMLTransaction>\n</XMLGroup>\n</XMLTransmission>\n</XMLBundle>\n`;
}

async function writeBulkStatusFile({ asn, outputDir }) {
  const now = new Date();
  const xmlContent = buildBulkStatusXml({ asn, now });
  const fileTimestamp = formatFileTimestamp(now);
  const fileName = `DAVIESTN_E2ASOS_BulkStatus_1.0_${fileTimestamp}_${asn}.xml`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, fileName);

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.writeFile(filePath, xmlContent, "utf8");

  return {
    fileName,
    filePath,
    xmlContent,
  };
}

module.exports = {
  writeBulkStatusFile,
};

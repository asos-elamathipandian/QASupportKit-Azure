function normalizeCarrier(input) {
  return String(input || "")
    .trim()
    .toLowerCase();
}

function getCarrierProfile(carrierInput = "DT") {
  const normalized = normalizeCarrier(carrierInput);

  if (["dt", "davies turner", "daviestn"].includes(normalized)) {
    return {
      input: "DT",
      vbkconCaName: "Davies Turner",
      vbkconCaId: "3",
      shipmentCaName: "Davies Turner",
      shipmentCaId: "DT",
      filePrefix: "DAVIESTN",
      receiver: "E2ASOS",
      sender: "DAVIESTN",
    };
  }

  if (["maersk", "maeu"].includes(normalized)) {
    return {
      input: "Maersk",
      vbkconCaName: "Maersk",
      vbkconCaId: "12",
      shipmentCaName: "Maersk",
      shipmentCaId: "12",
      filePrefix: "MAEU",
      receiver: "E2ASOS",
      sender: "MAEU",
    };
  }

  if (["advanced", "adv"].includes(normalized)) {
    return {
      input: "Advanced",
      vbkconCaName: "Advanced Processing",
      vbkconCaId: "5",
      shipmentCaName: "Advanced Processing",
      shipmentCaId: "5",
      filePrefix: "ADV",
      receiver: "E2ASOS",
      sender: "ADV",
    };
  }

  if (["chr", "usa", "usa to usa repro carrier"].includes(normalized)) {
    return {
      input: "CHR",
      vbkconCaName: "USA to USA Repro Carrier",
      vbkconCaId: "10",
      shipmentCaName: "USA to USA Repro Carrier",
      shipmentCaId: "10",
      filePrefix: "RBTWTEST",
      receiver: "E2ASOS",
      sender: "RBTWTEST",
    };
  }

  throw new Error(
    `Invalid carrier: ${carrierInput}. Allowed values: DT, Maersk, Advanced, CHR`
  );
}

module.exports = { getCarrierProfile };
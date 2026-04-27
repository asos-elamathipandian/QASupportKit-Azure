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
    };
  }

  throw new Error(
    `Invalid carrier: ${carrierInput}. Allowed values: DT, Maersk, Advanced`
  );
}

module.exports = { getCarrierProfile };
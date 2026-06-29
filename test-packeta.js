require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const {
  PACKETA_API_PASSWORD,
  PACKETA_LABEL_FORMAT = "A7",
  PACKETA_LABEL_POSITION = "1",
  PACKETA_LABEL_COUNT = "1",
} = process.env;

function escapeXml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAnyTag(xml, tagNames) {
  for (const tagName of tagNames) {
    const value = extractTag(xml, tagName);
    if (value) return value;
  }

  return null;
}

async function callPacketaXml(xml) {
  const response = await axios.post("https://www.zasilkovna.cz/api/rest", xml, {
    headers: {
      "Content-Type": "application/xml",
    },
    timeout: 30000,
  });

  return response.data;
}

function buildClaimAttributesXml(packetData) {
  return `
    <number>${escapeXml(packetData.orderNumber)}</number>

    <name>${escapeXml(packetData.customerName)}</name>
    <surname>${escapeXml(packetData.customerSurname || ".")}</surname>
    <email>${escapeXml(packetData.customerEmail)}</email>
    <phone>${escapeXml(packetData.customerPhone)}</phone>

    <value>${escapeXml(packetData.value)}</value>
    <currency>${escapeXml(packetData.currency)}</currency>

    <eshop>${escapeXml(packetData.eshop || "MedenceOrias")}</eshop>
    <note>${escapeXml(packetData.note)}</note>

    <sendEmailToCustomer>0</sendEmailToCustomer>
  `;
}

function buildCreatePacketClaimWithPasswordXml(packetData, variant) {
  const attrs = buildClaimAttributesXml(packetData);

  if (variant === "claimWithPasswordAttributes") {
    return `<?xml version="1.0" encoding="utf-8"?>
<createPacketClaimWithPassword>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <claimWithPasswordAttributes>
    ${attrs}
  </claimWithPasswordAttributes>
</createPacketClaimWithPassword>`;
  }

  if (variant === "attributes") {
    return `<?xml version="1.0" encoding="utf-8"?>
<createPacketClaimWithPassword>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <attributes>
    ${attrs}
  </attributes>
</createPacketClaimWithPassword>`;
  }

  if (variant === "packetAttributes") {
    return `<?xml version="1.0" encoding="utf-8"?>
<createPacketClaimWithPassword>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <packetAttributes>
    ${attrs}
  </packetAttributes>
</createPacketClaimWithPassword>`;
  }

  if (variant === "claimAttributes") {
    return `<?xml version="1.0" encoding="utf-8"?>
<createPacketClaimWithPassword>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <claimAttributes>
    ${attrs}
  </claimAttributes>
</createPacketClaimWithPassword>`;
  }

  throw new Error(`Ismeretlen variant: ${variant}`);
}

function buildPacketLabelPdfXml(packetId) {
  return `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <packetId>${escapeXml(packetId)}</packetId>
  <format>${escapeXml(PACKETA_LABEL_FORMAT)}</format>
  <offset>${escapeXml(PACKETA_LABEL_POSITION)}</offset>
</packetLabelPdf>`;
}

function buildPacketLabelPdfByBarcodeXml(barcode) {
  return `<?xml version="1.0" encoding="utf-8"?>
<packetLabelPdf>
  <apiPassword>${escapeXml(PACKETA_API_PASSWORD)}</apiPassword>
  <barcode>${escapeXml(barcode)}</barcode>
  <format>${escapeXml(PACKETA_LABEL_FORMAT)}</format>
  <offset>${escapeXml(PACKETA_LABEL_POSITION)}</offset>
</packetLabelPdf>`;
}

async function tryCreateClaimPacket(packetData) {
  const variants = [
    "claimWithPasswordAttributes",
    "attributes",
    "packetAttributes",
    "claimAttributes",
  ];

  for (const variant of variants) {
    console.log("Próba:", variant);

    const xml = buildCreatePacketClaimWithPasswordXml(packetData, variant);
    const response = await callPacketaXml(xml);

    console.log(response);

    const status = extractTag(response, "status");

    if (status === "ok") {
      const packetId = extractAnyTag(response, [
        "id",
        "packetId",
        "packet_id",
      ]);

      const barcode = extractAnyTag(response, [
        "barcode",
        "packetBarcode",
        "barcodeText",
        "code",
      ]);

      const password = extractAnyTag(response, [
        "password",
        "claimPassword",
        "submissionPassword",
      ]);

      return {
        success: true,
        variant,
        response,
        packetId,
        barcode,
        password,
      };
    }

    console.log("Nem sikerült ezzel a változattal:", variant);
    console.log("----------");
  }

  return {
    success: false,
  };
}

async function main() {
  if (!PACKETA_API_PASSWORD) {
    throw new Error("Hiányzik a PACKETA_API_PASSWORD a .env fájlból.");
  }

  const packetData = {
    orderNumber: "PO-090-12329685781113212",
    customerName: "Rózsa Katalin",
    customerSurname: ".",
    customerEmail: "hwwiyhxnup130de@eul.shipping.temuemail.com",
    customerPhone: "+36304267556",
    value: 22544,
    currency: "HUF",
    eshop: "MedenceOrias",
    note: "Temu return label test - PO-090-12329685781113212",
  };

  console.log("Packeta Reklamációs asszisztens / Return packet létrehozása...");
  console.log("API method: createPacketClaimWithPassword");
  console.log("label format:", PACKETA_LABEL_FORMAT);
  console.log("label position:", PACKETA_LABEL_POSITION);
  console.log("label count:", PACKETA_LABEL_COUNT);

  const createResult = await tryCreateClaimPacket(packetData);

  if (!createResult.success) {
    console.log("Nem sikerült létrehozni a Reklamációs asszisztens csomagot egyik XML változattal sem.");
    return;
  }

  console.log("Sikeres Packeta létrehozás.");
  console.log("Sikeres variant:", createResult.variant);
  console.log("Packeta packetId:", createResult.packetId || "-");
  console.log("Packeta barcode:", createResult.barcode || "-");
  console.log("Packeta password:", createResult.password || "-");

  let labelXml = null;

  if (createResult.packetId) {
    labelXml = buildPacketLabelPdfXml(createResult.packetId);
  } else if (createResult.barcode) {
    labelXml = buildPacketLabelPdfByBarcodeXml(createResult.barcode);
  } else {
    console.log("Nincs packetId vagy barcode a válaszban, ezért nem tudok PDF-et kérni.");
    return;
  }

  console.log("Packeta PDF címke lekérése...");

  const labelResponse = await callPacketaXml(labelXml);
  console.log(labelResponse);

  const labelStatus = extractTag(labelResponse, "status");

  if (labelStatus && labelStatus !== "ok") {
    console.log("A PDF címke lekérése nem sikerült.");
    return;
  }

  const pdfBase64 = extractAnyTag(labelResponse, [
    "result",
    "pdf",
    "content",
    "data",
  ]);

  if (!pdfBase64) {
    console.log("Nem jött PDF tartalom.");
    return;
  }

  const outputDir = path.join(__dirname, "labels");
  fs.mkdirSync(outputDir, { recursive: true });

  const safeId =
    createResult.packetId ||
    createResult.barcode ||
    createResult.password ||
    Date.now();

  const outputPath = path.join(
    outputDir,
    `${packetData.orderNumber}-${safeId}.pdf`
  );

  fs.writeFileSync(outputPath, Buffer.from(pdfBase64, "base64"));

  console.log("PDF mentve ide:");
  console.log(outputPath);
}

main().catch((error) => {
  console.error("Packeta teszt hiba:");

  if (error.response) {
    console.error("HTTP status:", error.response.status);
    console.error(error.response.data);
    return;
  }

  console.error(error.message);
});
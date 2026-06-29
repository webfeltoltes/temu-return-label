require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const {
  TEMU_APP_KEY,
  TEMU_APP_SECRET,
  TEMU_ACCESS_TOKEN,
  TEMU_API_URL = "https://openapi-b-eu.temu.com/openapi/router",
  PORT = 3000,
} = process.env;

function signValue(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function makeSign(params, appSecret) {
  const sortedKeys = Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== null && value !== "";
    })
    .sort();

  let signStr = appSecret;

  for (const key of sortedKeys) {
    signStr += key + signValue(params[key]);
  }

  signStr += appSecret;

  return crypto
    .createHash("md5")
    .update(signStr, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function callTemu(type, payload = {}, accessToken = TEMU_ACCESS_TOKEN) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const params = {
    type,
    app_key: TEMU_APP_KEY,
    access_token: accessToken,
    timestamp,
    data_type: "JSON",
    ...payload,
  };

  params.sign = makeSign(params, TEMU_APP_SECRET);

  const response = await axios.post(TEMU_API_URL, params, {
    headers: {
      "content-type": "application/json",
    },
    timeout: 30000,
  });

  return response.data;
}

function normalizeTemuAmount(amount) {
  if (amount === null || amount === undefined) return null;

  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount)) {
    return {
      raw: amount,
      dividedBy100: null,
    };
  }

  return {
    raw: numericAmount,
    dividedBy100: numericAmount / 100,
  };
}

function getRefundAmount(afterSalesDetailResult) {
  const result = afterSalesDetailResult?.result || {};

  const buyerTotalRefund = result?.refundSummary?.buyerTotalRefund;

  if (buyerTotalRefund?.amount !== undefined) {
    const normalized = normalizeTemuAmount(buyerTotalRefund.amount);

    return {
      valueRaw: normalized.raw,
      valueDividedBy100: normalized.dividedBy100,
      currency: buyerTotalRefund.currency || null,
      source: "refundSummary.buyerTotalRefund",
    };
  }

  const firstAfterSales = result?.afterSalesList?.[0];
  const applyRefundAmount = firstAfterSales?.applyRefundAmount;

  if (applyRefundAmount?.amount !== undefined) {
    const normalized = normalizeTemuAmount(applyRefundAmount.amount);

    return {
      valueRaw: normalized.raw,
      valueDividedBy100: normalized.dividedBy100,
      currency: applyRefundAmount.currency || null,
      source: "afterSalesList[0].applyRefundAmount",
    };
  }

  return {
    valueRaw: null,
    valueDividedBy100: null,
    currency: null,
    source: null,
  };
}

async function getOrderDetailV2(parentOrderSn) {
  const attempts = [];

  const attempt1 = await callTemu("bg.order.detail.v2.get", {
    parentOrderSn,
    fulfillmentTypeList: ["fulfillBySeller"],
  });

  attempts.push({
    type: "bg.order.detail.v2.get",
    mode: "top-level",
    response: attempt1,
  });

  if (attempt1.success) {
    return {
      success: true,
      usedMode: "top-level",
      result: attempt1,
      attempts,
    };
  }

  const attempt2 = await callTemu("bg.order.detail.v2.get", {
    request: {
      parentOrderSn,
      fulfillmentTypeList: ["fulfillBySeller"],
    },
  });

  attempts.push({
    type: "bg.order.detail.v2.get",
    mode: "request-wrapper",
    response: attempt2,
  });

  if (attempt2.success) {
    return {
      success: true,
      usedMode: "request-wrapper",
      result: attempt2,
      attempts,
    };
  }

  return {
    success: false,
    usedMode: null,
    result: attempt2,
    attempts,
  };
}

async function getShippingInfo(parentOrderSn) {
  const attempts = [];

  const attempt1 = await callTemu("bg.order.shippinginfo.v2.get", {
    parentOrderSn,
  });

  attempts.push({
    type: "bg.order.shippinginfo.v2.get",
    mode: "top-level",
    response: attempt1,
  });

  if (attempt1.success) {
    return {
      success: true,
      usedType: "bg.order.shippinginfo.v2.get",
      usedMode: "top-level",
      result: attempt1,
      attempts,
    };
  }

  const attempt2 = await callTemu("bg.order.shippinginfo.v2.get", {
    request: {
      parentOrderSn,
    },
  });

  attempts.push({
    type: "bg.order.shippinginfo.v2.get",
    mode: "request-wrapper",
    response: attempt2,
  });

  if (attempt2.success) {
    return {
      success: true,
      usedType: "bg.order.shippinginfo.v2.get",
      usedMode: "request-wrapper",
      result: attempt2,
      attempts,
    };
  }

  const attempt3 = await callTemu("bg.order.decryptshippinginfo.get", {
    parentOrderSn,
  });

  attempts.push({
    type: "bg.order.decryptshippinginfo.get",
    mode: "top-level",
    response: attempt3,
  });

  if (attempt3.success) {
    return {
      success: true,
      usedType: "bg.order.decryptshippinginfo.get",
      usedMode: "top-level",
      result: attempt3,
      attempts,
    };
  }

  const attempt4 = await callTemu("bg.order.decryptshippinginfo.get", {
    request: {
      parentOrderSn,
    },
  });

  attempts.push({
    type: "bg.order.decryptshippinginfo.get",
    mode: "request-wrapper",
    response: attempt4,
  });

  if (attempt4.success) {
    return {
      success: true,
      usedType: "bg.order.decryptshippinginfo.get",
      usedMode: "request-wrapper",
      result: attempt4,
      attempts,
    };
  }

  return {
    success: false,
    usedType: null,
    usedMode: null,
    result: attempt4,
    attempts,
  };
}

function extractShippingFields(shippingInfo) {
  const result = shippingInfo?.result?.result || shippingInfo?.result || {};

  return {
    customerEmail: result.mail || null,
    customerPhone: result.mobile || result.backupMobile || null,
    customerName: result.receiptName || null,
    country: result.regionName1 || null,
    county: result.regionName2 || null,
    city: result.regionName3 || null,
    postCode: result.postCode || null,
    addressLineAll: result.addressLineAll || null,
    addressLine1: result.addressLine1 || null,
    addressLine2: result.addressLine2 || null,
    addressLine3: result.addressLine3 || null,
  };
}

app.get("/", (req, res) => {
  res.send(`
    <h2>Temu return_label app működik.</h2>

    <p>Token teszt:</p>
    <code>/temu/token-info</code>

    <p>Aftersales címkére várók:</p>
    <code>/temu/aftersales-test</code>

    <p>Aftersales részletek:</p>
    <code>/temu/aftersales-detail?parentOrderSn=PO-090-12329685781113212&parentAfterSalesSn=PO-090-12329685781113212-D01</code>

    <p>Order detail V2:</p>
    <code>/temu/order-detail?parentOrderSn=PO-090-12329685781113212</code>

    <p>Shipping info:</p>
    <code>/temu/shipping-info?parentOrderSn=PO-090-12329685781113212</code>

    <p>Packeta adat teszt:</p>
    <code>/temu/packeta-data?parentOrderSn=PO-090-12329685781113212&parentAfterSalesSn=PO-090-12329685781113212-D01</code>

    <p>Webhook endpoint:</p>
    <code>/temu/webhook</code>
  `);
});

app.get("/temu/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Nincs code paraméter az URL-ben.");
  }

  try {
    const result = await callTemu(
      "bg.open.accesstoken.create",
      { code },
      code
    );

    res.json({
      message: "Sikeres Temu authorization callback.",
      note: "Az accessToken értéket mentsd el biztonságosan.",
      result,
    });
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu token lekérés hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu token lekérés hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/token-info", async (req, res) => {
  try {
    const result = await callTemu("bg.open.accesstoken.info.get");
    res.json(result);
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu token info hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu token info hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/aftersales-test", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    const pageSize = 200;
    let pageNo = 1;
    let allData = [];
    let hasMore = true;
    let lastRequestId = null;

    while (hasMore && pageNo <= 20) {
      const result = await callTemu("bg.aftersales.parentaftersales.list.get", {
        pageNo,
        pageSize,
        updateAtStart: thirtyDaysAgo,
        updateAtEnd: now,
        afterSalesStatusGroup: 1,
      });

      lastRequestId = result.requestId;

      if (!result.success) {
        return res.json({
          success: false,
          pageNo,
          result,
        });
      }

      const data = result?.result?.data || [];
      allData = allData.concat(data);

      if (data.length < pageSize) {
        hasMore = false;
      } else {
        pageNo++;
      }
    }

    const labelNeeded = allData.filter((item) => {
      return item.parentAfterSalesStatus === 8;
    });

    res.json({
      success: true,
      requestId: lastRequestId,
      checkedPages: pageNo,
      returnedCount: allData.length,
      labelNeededCount: labelNeeded.length,
      labelNeeded,
      allData,
    });
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu aftersales lista hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu aftersales lista hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/aftersales-detail", async (req, res) => {
  try {
    const parentOrderSn = req.query.parentOrderSn;
    const parentAfterSalesSn = req.query.parentAfterSalesSn;

    if (!parentOrderSn || !parentAfterSalesSn) {
      return res.status(400).json({
        message: "Hiányzik a parentOrderSn vagy parentAfterSalesSn paraméter.",
        example:
          "/temu/aftersales-detail?parentOrderSn=PO-090-12329685781113212&parentAfterSalesSn=PO-090-12329685781113212-D01",
      });
    }

    const result = await callTemu(
      "temu.aftersales.parentaftersales.detail.get",
      {
        parentOrderSn,
        parentAfterSalesSn,
      }
    );

    res.json(result);
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu aftersales detail hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu aftersales detail hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/order-detail", async (req, res) => {
  try {
    const parentOrderSn = req.query.parentOrderSn;

    if (!parentOrderSn) {
      return res.status(400).json({
        message: "Hiányzik a parentOrderSn paraméter.",
        example: "/temu/order-detail?parentOrderSn=PO-090-12329685781113212",
      });
    }

    const result = await getOrderDetailV2(parentOrderSn);

    res.json(result);
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu order detail V2 hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu order detail V2 hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/shipping-info", async (req, res) => {
  try {
    const parentOrderSn = req.query.parentOrderSn;

    if (!parentOrderSn) {
      return res.status(400).json({
        message: "Hiányzik a parentOrderSn paraméter.",
        example: "/temu/shipping-info?parentOrderSn=PO-090-12329685781113212",
      });
    }

    const shippingInfo = await getShippingInfo(parentOrderSn);
    const shippingFields = extractShippingFields(shippingInfo);

    res.json({
      success: shippingInfo.success,
      usedType: shippingInfo.usedType,
      usedMode: shippingInfo.usedMode,
      shippingFields,
      debug: shippingInfo,
    });
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Temu shipping info hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Temu shipping info hiba.",
      error: error.message,
    });
  }
});

app.get("/temu/packeta-data", async (req, res) => {
  try {
    const parentOrderSn = req.query.parentOrderSn;
    const parentAfterSalesSn = req.query.parentAfterSalesSn;

    if (!parentOrderSn || !parentAfterSalesSn) {
      return res.status(400).json({
        message: "Hiányzik a parentOrderSn vagy parentAfterSalesSn paraméter.",
        example:
          "/temu/packeta-data?parentOrderSn=PO-090-12329685781113212&parentAfterSalesSn=PO-090-12329685781113212-D01",
      });
    }

    const afterSalesDetail = await callTemu(
      "temu.aftersales.parentaftersales.detail.get",
      {
        parentOrderSn,
        parentAfterSalesSn,
      }
    );

    const orderDetail = await getOrderDetailV2(parentOrderSn);
    const shippingInfo = await getShippingInfo(parentOrderSn);

    const refund = getRefundAmount(afterSalesDetail);
    const shippingFields = extractShippingFields(shippingInfo);

    res.json({
      success: true,
      packetaData: {
        orderNumber: parentOrderSn,
        parentAfterSalesSn,
        value: refund.valueDividedBy100,
        valueRaw: refund.valueRaw,
        currency: refund.currency,
        customerEmail: shippingFields.customerEmail,
        customerPhone: shippingFields.customerPhone,
        customerName: shippingFields.customerName,
      },
      shippingAddressDebug: {
        country: shippingFields.country,
        county: shippingFields.county,
        city: shippingFields.city,
        postCode: shippingFields.postCode,
        addressLineAll: shippingFields.addressLineAll,
        addressLine1: shippingFields.addressLine1,
        addressLine2: shippingFields.addressLine2,
        addressLine3: shippingFields.addressLine3,
      },
      debug: {
        refundSource: refund.source,
        afterSalesSuccess: afterSalesDetail.success,
        orderDetailSuccess: orderDetail.success,
        orderDetailUsedMode: orderDetail.usedMode,
        shippingInfoSuccess: shippingInfo.success,
        shippingInfoUsedType: shippingInfo.usedType,
        shippingInfoUsedMode: shippingInfo.usedMode,
        afterSalesDetail,
        orderDetail,
        shippingInfo,
      },
    });
  } catch (error) {
    if (error.response) {
      return res.status(500).json({
        message: "Packeta adat összeállítás hiba.",
        status: error.response.status,
        data: error.response.data,
      });
    }

    res.status(500).json({
      message: "Packeta adat összeállítás hiba.",
      error: error.message,
    });
  }
});

app.post("/temu/webhook", async (req, res) => {
  console.log("Temu webhook érkezett");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);

  res.status(200).json({
    result: {},
  });
});

app.listen(PORT, () => {
  console.log(`Server fut: http://localhost:${PORT}`);
});
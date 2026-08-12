import axios from "axios";

/**
 * Returns the base API URL for Daraja, based on MPESA_ENV.
 */
const getBaseUrl = (): string => {
  return process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
};

/**
 * Generates a Daraja-format timestamp: YYYYMMDDHHMMSS.
 */
const buildTimestamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${date}${hours}${minutes}${seconds}`;
};

/**
 * Builds the Daraja STK password: base64(shortCode + passkey + timestamp).
 */
const buildPassword = (shortCode: string, passkey: string, timestamp: string): string => {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");
};

/**
 * Normalizes a Kenyan phone number to Daraja's expected 254XXXXXXXXX format.
 */
export const normalizePhoneNumber = (phone: string): string => {
  const digitsOnly = String(phone).replace(/[^0-9]/g, "");
  let msisdn = digitsOnly;

  if (msisdn.startsWith("0")) {
    msisdn = `254${msisdn.slice(1)}`;
  }

  if (!msisdn.startsWith("254")) {
    if (digitsOnly.length === 9) {
      msisdn = `254${digitsOnly}`;
    }
  }

  if (!/^254\d{9}$/.test(msisdn)) {
    throw new Error(`Invalid Kenyan phone format: ${phone}`);
  }

  return msisdn;
};

/**
 * Retrieves a Daraja OAuth 2.0 access token using client credentials.
 */
export const getAccessToken = async (): Promise<string> => {
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || "").trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || "").trim();

  if (!consumerKey || !consumerSecret) {
    throw new Error("Daraja credentials (MPESA_CONSUMER_KEY/SECRET) not configured");
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const base = getBaseUrl();

  try {
    const response = await axios.get(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return response.data.access_token;
  } catch (err: any) {
    throw new Error(`Daraja OAuth failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};

/**
 * Initiates an M-Pesa STK push for a tab payment.
 * accountReference is the tab's tabNumber so the customer's M-Pesa statement
 * shows which sale tab the payment belongs to.
 */
export const initiateStkPush = async (params: {
  amount: number;
  phone: string;
  accountReference: string;
  transactionDesc: string;
}): Promise<any> => {
  const shortCode = process.env.MPESA_SHORT_CODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.CALLBACK_URL;

  if (!shortCode || !passkey || !callbackUrl) {
    throw new Error("Daraja configuration missing (MPESA_SHORT_CODE, MPESA_PASSKEY, or CALLBACK_URL)");
  }

  const accessToken = await getAccessToken();
  const base = getBaseUrl();
  const timestamp = buildTimestamp();
  const password = buildPassword(shortCode, passkey, timestamp);
  const normalizedPhone = normalizePhoneNumber(params.phone);

  const payload = {
    BusinessShortCode: Number(shortCode),
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(params.amount),
    PartyA: normalizedPhone,
    PartyB: Number(shortCode),
    PhoneNumber: normalizedPhone,
    CallBackURL: `${callbackUrl}/api/payments/mpesa/callback`,
    AccountReference: params.accountReference,
    TransactionDesc: params.transactionDesc,
  };

  try {
    const resp = await axios.post(`${base}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      merchantRequestId: resp.data.MerchantRequestID,
      checkoutRequestId: resp.data.CheckoutRequestID,
      raw: resp.data,
    };
  } catch (err: any) {
    throw new Error(`Daraja STK Push failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};

/**
 * Parses a Daraja STK callback payload into a normalized shape.
 */
export const parseCallback = (body: any) => {
  const stk = body?.Body?.stkCallback;
  if (!stk) return { valid: false };

  const resultCode = stk.ResultCode;
  const success = String(resultCode) === "0";
  const checkoutRequestId = stk.CheckoutRequestID;
  const merchantRequestId = stk.MerchantRequestID;
  const metadata = stk.CallbackMetadata?.Item || [];

  let amount, phone, mpesaReceiptNumber;
  for (const item of metadata) {
    if (item.Name === "Amount") amount = item.Value;
    if (item.Name === "PhoneNumber") phone = item.Value;
    if (item.Name === "MpesaReceiptNumber") mpesaReceiptNumber = item.Value;
  }

  return {
    valid: true,
    success,
    checkoutRequestId,
    merchantRequestId,
    amount,
    phone,
    mpesaReceiptNumber,
    resultCode,
    resultDesc: stk.ResultDesc,
    raw: body,
  };
};

/**
 * Queries Daraja for the current status of a previously initiated STK push.
 */
export const queryStkPushStatus = async (checkoutRequestId: string): Promise<any> => {
  const shortCode = process.env.MPESA_SHORT_CODE;
  const passkey = process.env.MPESA_PASSKEY;

  if (!shortCode || !passkey) {
    throw new Error("Daraja configuration missing (MPESA_SHORT_CODE, MPESA_PASSKEY)");
  }

  const accessToken = await getAccessToken();
  const base = getBaseUrl();
  const timestamp = buildTimestamp();
  const password = buildPassword(shortCode, passkey, timestamp);

  try {
    const resp = await axios.post(
      `${base}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: Number(shortCode),
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    return {
      ok: true,
      resultCode: resp.data.ResultCode,
      resultDesc: resp.data.ResultDesc,
      raw: resp.data,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.response?.data?.errorMessage || err.message,
      raw: err.response?.data,
    };
  }
};

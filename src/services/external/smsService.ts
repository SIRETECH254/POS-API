// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require("africastalking");

let sms: any = null;

if (
  process.env.AFRICAS_TALKING_API_KEY &&
  process.env.AFRICAS_TALKING_USERNAME &&
  process.env.AFRICAS_TALKING_API_KEY !== "your-africastalking-api-key" &&
  process.env.AFRICAS_TALKING_USERNAME !== "your-africastalking-username"
) {
  const africasTalking = new AfricasTalking({
    apiKey: process.env.AFRICAS_TALKING_API_KEY,
    username: process.env.AFRICAS_TALKING_USERNAME,
  });
  sms = africasTalking.SMS;
} else {
  console.warn("Africa's Talking SMS service not initialized: Invalid or missing credentials");
}

const formatPhoneNumber = (phone: string): string => {
  let cleanNumber = phone.replace(/[\s\-\+]/g, "");

  if (cleanNumber.startsWith("0")) {
    cleanNumber = "254" + cleanNumber.substring(1);
  }

  if (!cleanNumber.startsWith("254")) {
    cleanNumber = "254" + cleanNumber;
  }

  return "+" + cleanNumber;
};

export const sendPasswordResetSMS = async (
  phone: string,
  resetToken: string,
  name: string = "User"
): Promise<{ success: boolean; error?: string }> => {
  if (!sms) {
    console.warn("SMS skipped: Africa's Talking not configured");
    return { success: false, error: "SMS service not configured" };
  }

  try {
    const formattedPhone = formatPhoneNumber(phone);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const message = `Hello ${name}, reset your password: ${resetUrl}. Expires in 15 minutes.`;

    const options: any = {
      to: [formattedPhone],
      message,
    };

    if (process.env.SMS_SENDER_ID) {
      options.from = process.env.SMS_SENDER_ID;
    }

    const result = await sms.send(options);

    if (result?.SMSMessageData?.Recipients?.[0]?.status === "Success") {
      return {
        success: true,
      };
    }

    return {
      success: false,
      error: result?.SMSMessageData?.Recipients?.[0]?.status || "Unknown SMS status",
    };
  } catch (error: any) {
    console.error("Error sending password reset SMS:", error);
    return { success: false, error: error.message };
  }
};

export const sendGenericSMS = async (
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> => {
  if (!sms) {
    console.warn("SMS skipped: Africa's Talking not configured");
    return { success: false, error: "SMS service not configured" };
  }

  try {
    const formattedPhone = formatPhoneNumber(phone);
    const options: any = {
      to: [formattedPhone],
      message,
    };

    if (process.env.SMS_SENDER_ID) {
      options.from = process.env.SMS_SENDER_ID;
    }

    const result = await sms.send(options);

    if (result?.SMSMessageData?.Recipients?.[0]?.status === "Success") {
      return { success: true };
    }

    return {
      success: false,
      error: result?.SMSMessageData?.Recipients?.[0]?.status || "Unknown SMS status",
    };
  } catch (error: any) {
    console.error("Error sending SMS:", error);
    return { success: false, error: error.message };
  }
};

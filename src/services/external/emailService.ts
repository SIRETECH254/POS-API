import sgMail from "@sendgrid/mail";
import { errorHandler } from "../../middleware/errorHandler";

const initializeSendGrid = (): void => {
  if (
    !process.env.SMTP_PASS ||
    process.env.SMTP_PASS === "your-sendgrid-api-key"
  ) {
    console.warn("SendGrid email service not initialized: Invalid or missing SMTP_PASS");
    return;
  }
  sgMail.setApiKey(process.env.SMTP_PASS);
};

initializeSendGrid();

const fromEmail = process.env.SMTP_USER || process.env.FROM_EMAIL || "noreply@pos-api.com";

export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string,
  name: string = "User"
): Promise<{ success: boolean; error?: string }> => {
  if (!email || !resetToken) {
    throw errorHandler(400, "Email and reset token are required");
  }

  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === "your-sendgrid-api-key") {
    console.warn("Email skipped: SendGrid not configured");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const message = `Hello ${name}, reset your password using: ${resetUrl}. This link expires in 15 minutes.`;

    const msg = {
      to: email,
      from: `"POS API" <${fromEmail}>`,
      subject: "Password Reset",
      text: message,
      html: `<p>Hello ${name},</p><p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 15 minutes.</p>`,
    };

    await sgMail.send(msg);
    return { success: true };
  } catch (error: any) {
    console.error("Error sending password reset email:", error);
    if (error.response) {
      console.error(error.response.body);
    }
    return { success: false, error: error.message };
  }
};

export const sendGenericEmail = async (
  email: string,
  subject: string,
  message: string
): Promise<{ success: boolean; error?: string }> => {
  if (!email || !subject || !message) {
    throw errorHandler(400, "Email, subject, and message are required");
  }

  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === "your-sendgrid-api-key") {
    console.warn("Email skipped: SendGrid not configured");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const msg = {
      to: email,
      from: `"POS API" <${fromEmail}>`,
      subject,
      text: message,
      html: `<p>${message}</p>`,
    };

    await sgMail.send(msg);
    return { success: true };
  } catch (error: any) {
    console.error("Error sending email:", error);
    return { success: false, error: error.message };
  }
};

import { sendPasswordResetEmail } from "../external/emailService";
import { sendPasswordResetSMS } from "../external/smsService";

export const sendPasswordResetNotification = async (
  email: string,
  phone: string,
  resetToken: string,
  name: string
): Promise<void> => {
  const results = await Promise.allSettled([
    sendPasswordResetEmail(email, resetToken, name),
    sendPasswordResetSMS(phone, resetToken, name),
  ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Password reset notification failed (${index === 0 ? "email" : "sms"}):`, result.reason);
    }
  });
};

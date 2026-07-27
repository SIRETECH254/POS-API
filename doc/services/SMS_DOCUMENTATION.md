# 📱 POS API - SMS Service Documentation

## 📋 Table of Contents
- [SMS Service Overview](#sms-service-overview)
- [Configuration](#configuration)
- [Key Functions/Service Methods](#key-functionsservice-methods)
- [Usage in Internal Services](#usage-in-internal-services)
- [Error Handling](#error-handling)

---

## SMS Service Overview

The SMS service handles outbound text messages using **Africa's Talking** API. It is used to deliver password reset links to staff members via SMS alongside email.

**Key Features:**
- **Password Reset Links:** Delivers secure reset links with a 15-minute expiry.
- **Generic Notifications:** Supports sending custom messages for any event.
- **Phone Number Formatting:** Normalizes Kenyan phone numbers to international format (`+254...`).
- **Graceful Degradation:** If Africa's Talking credentials are missing or invalid, sends are skipped with a warning — the server continues running.

---

## Configuration

Africa's Talking credentials are managed through environment variables and initialized in `src/services/external/smsService.ts`. The SDK is loaded via `require()` to avoid TypeScript construct signature issues.

**Environment Variables:**

| Variable | Description | Required |
|---|---|---|
| `AFRICAS_TALKING_API_KEY` | Africa's Talking API Key | Yes |
| `AFRICAS_TALKING_USERNAME` | Africa's Talking Username | Yes |
| `SMS_SENDER_ID` | Custom alphanumeric sender ID | Optional |
| `FRONTEND_URL` | Used to construct password reset URLs | Optional |

**File: `src/services/external/smsService.ts` — Initialization**

```typescript
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
```

> **Note:** `require()` is used instead of `import` because the `africastalking` package has no TypeScript types and its constructor has no compatible type signature. A manual type declaration lives at `src/types/africastalking.d.ts`.

---

## Key Functions/Service Methods

**File: `src/services/external/smsService.ts`**

### `formatPhoneNumber(phone)` _(internal helper)_

Normalizes a Kenyan phone number to international format.

```typescript
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
```

**Examples:**

| Input | Output |
|---|---|
| `0712345678` | `+254712345678` |
| `712345678` | `+254712345678` |
| `+254712345678` | `+254712345678` |

---

### `sendPasswordResetSMS(phone, resetToken, name?)`

Sends a password reset link to a staff member's phone via SMS.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `phone` | `string` | Yes | Recipient phone number (any Kenyan format) |
| `resetToken` | `string` | Yes | Raw reset token (not hashed) |
| `name` | `string` | No | Recipient display name (default: `"User"`) |

**Returns:** `Promise<{ success: boolean; error?: string }>`

```typescript
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
      return { success: true };
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
```

---

### `sendGenericSMS(phone, message)`

Sends a custom SMS message to a specified phone number.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `phone` | `string` | Yes | Recipient phone number (any Kenyan format) |
| `message` | `string` | Yes | SMS body text |

**Returns:** `Promise<{ success: boolean; error?: string }>`

```typescript
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
```

---

## Usage in Internal Services

The internal notification service (`src/services/internal/notificationService.ts`) calls SMS functions as part of multi-channel notifications.

```typescript
import { sendPasswordResetSMS } from "../external/smsService";

// Inside sendPasswordResetNotification — runs alongside email via Promise.allSettled
await sendPasswordResetSMS(phone, resetToken, name);
```

Both SMS and email are fired concurrently. A failure in one does not block the other.

---

## Error Handling

- Functions return `{ success: false, error: string }` on failure — they do not throw.
- If the Africa's Talking `sms` instance is `null` (not configured), sends return `{ success: false }` immediately with a console warning.
- The caller (`notificationService`) uses `Promise.allSettled` so an SMS failure never crashes the controller flow.
- Africa's Talking API errors are caught locally and logged via `console.error`.

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team

# 📧 POS API - Email Service Documentation

## 📋 Table of Contents
- [Email Service Overview](#email-service-overview)
- [Configuration](#configuration)
- [Key Functions/Service Methods](#key-functionsservice-methods)
- [Usage in Internal Services](#usage-in-internal-services)
- [Error Handling](#error-handling)

---

## Email Service Overview

The email service handles outbound email communications using **SendGrid** (`@sendgrid/mail`). It is used to deliver password reset links to staff members.

**Key Features:**
- **Password Reset Links:** Delivers secure reset links with a 15-minute expiry.
- **Generic Notifications:** Supports sending custom messages for any event.
- **Graceful Degradation:** If SendGrid is not configured, sends are skipped with a warning — the server continues running.
- **HTML Support:** Emails include both plain-text and HTML content.

---

## Configuration

Email credentials are managed through environment variables and initialized in `src/services/external/emailService.ts`.

**Environment Variables:**

| Variable | Description | Required |
|---|---|---|
| `SMTP_PASS` | SendGrid API Key | Yes |
| `SMTP_USER` | Sender email address | Optional |
| `FROM_EMAIL` | Fallback sender address (default: `noreply@pos-api.com`) | Optional |
| `FRONTEND_URL` | Used to construct password reset URLs | Optional |

**File: `src/services/external/emailService.ts` — Initialization**

```typescript
import sgMail from "@sendgrid/mail";

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
```

> **Note:** The service initializes at module load time. If `SMTP_PASS` is missing or set to the placeholder value, a warning is logged and all send calls return `{ success: false }` without throwing.

---

## Key Functions/Service Methods

**File: `src/services/external/emailService.ts`**

### `sendPasswordResetEmail(email, resetToken, name?)`

Sends a password reset link to a staff member's email.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | Recipient email address |
| `resetToken` | `string` | Yes | Raw reset token (not hashed) |
| `name` | `string` | No | Recipient display name (default: `"User"`) |

**Returns:** `Promise<{ success: boolean; error?: string }>`

```typescript
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
```

---

### `sendGenericEmail(email, subject, message)`

Sends a custom email with a specified subject and body.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | Recipient email address |
| `subject` | `string` | Yes | Email subject line |
| `message` | `string` | Yes | Plain-text body (also wrapped in `<p>` for HTML) |

**Returns:** `Promise<{ success: boolean; error?: string }>`

```typescript
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
```

---

## Usage in Internal Services

The internal notification service (`src/services/internal/notificationService.ts`) calls email functions as part of multi-channel notifications.

```typescript
import { sendPasswordResetEmail } from "../external/emailService";

// Inside sendPasswordResetNotification — runs alongside SMS via Promise.allSettled
await sendPasswordResetEmail(email, resetToken, name);
```

Both email and SMS are fired concurrently. A failure in one does not block the other.

---

## Error Handling

- Functions return `{ success: false, error: string }` on failure — they do not throw.
- The exception is input validation: missing required arguments throw via `errorHandler(400, ...)`.
- SendGrid response errors are logged with `console.error(error.response.body)` for debugging.
- The caller (`notificationService`) uses `Promise.allSettled` so an email failure never crashes the controller flow.

---

**Last Updated:** 2026-07-27
**Version:** 1.0.0
**Maintainer:** POS API Development Team

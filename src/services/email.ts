import nodemailer from "nodemailer";
import { config } from "../config";
import type { EmailMessage } from "../types";

const transporter =
  config.smtp.user && config.smtp.pass
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      })
    : null;

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!transporter) {
    console.log("[email:dev]", {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return;
  }

  await transporter.sendMail({
    from: config.smtp.user,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

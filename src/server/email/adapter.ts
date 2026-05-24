import { ChannelsEnum, Pingram } from "pingram";

import { getClarificationEmailSender, getEmailProviderName, getPingramApiKey } from "../env";

export type ClarificationEmailMessage = {
  html: string;
  subject: string;
  text: string;
  to: {
    email: string;
    id: string;
  };
};

export type ClarificationEmailResult = {
  messages: string[];
  trackingId: string;
};

export type ClarificationEmailProvider = (
  message: ClarificationEmailMessage
) => Promise<ClarificationEmailResult>;

export class EmailProviderError extends Error {
  rawResponse: unknown;

  constructor(message: string, rawResponse: unknown = null) {
    super(message);
    this.name = "EmailProviderError";
    this.rawResponse = rawResponse;
  }
}

function defaultPingramProvider(): ClarificationEmailProvider {
  return async (message) => {
    if (getEmailProviderName() !== "pingram") {
      throw new EmailProviderError(`Unsupported email provider: ${getEmailProviderName()}.`);
    }

    const sender = getClarificationEmailSender();
    const client = new Pingram({
      apiKey: getPingramApiKey(),
      baseUrl: "https://api.pingram.io"
    });

    try {
      return await client.send({
        email: {
          html: message.html,
          previewText: message.text,
          senderEmail: sender.email,
          senderName: sender.name,
          subject: message.subject
        },
        forceChannels: [ChannelsEnum.EMAIL],
        to: {
          email: message.to.email,
          id: message.to.id
        },
        type: "email_compose_preview"
      });
    } catch (error) {
      throw new EmailProviderError(error instanceof Error ? error.message : "Pingram email send failed.", error);
    }
  };
}

export async function sendClarificationEmail(
  message: ClarificationEmailMessage,
  provider: ClarificationEmailProvider = defaultPingramProvider()
) {
  return provider(message);
}

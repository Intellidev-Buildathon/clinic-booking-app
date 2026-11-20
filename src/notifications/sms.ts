export interface SmsMessage {
  /** E.164 Indian mobile number, e.g. +919812345678. */
  to: string;
  body: string;
}

/** Sends SMS to patients. A real provider (with an India region) will implement this. */
export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

/** Development sender that logs messages instead of sending them. */
export class ConsoleSmsSender implements SmsSender {
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
    console.log(`[sms] to=${message.to} ${message.body}`);
  }
}

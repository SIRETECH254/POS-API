declare module "africastalking" {
  interface AfricasTalkingOptions {
    apiKey: string;
    username: string;
  }

  interface SMSSendOptions {
    to: string[];
    message: string;
    from?: string;
  }

  interface SMSRecipient {
    status: string;
    messageId?: string;
    cost?: string;
  }

  interface SMSSendResult {
    SMSMessageData?: {
      Recipients?: SMSRecipient[];
    };
  }

  interface SMSService {
    send(options: SMSSendOptions): Promise<SMSSendResult>;
  }

  interface AfricasTalkingInstance {
    SMS: SMSService;
  }

  function AfricasTalking(options: AfricasTalkingOptions): AfricasTalkingInstance;
  export = AfricasTalking;
}

declare module 'razorpay' {
  interface RazorpayOptions {
    key_id: string;
    key_secret: string;
  }
  class Razorpay {
    constructor(options: RazorpayOptions);
    orders: {
      create(options: Record<string, unknown>): Promise<any>;
    };
    payments: {
      capture(paymentId: string, amount: number, currency: string): Promise<any>;
      refund(paymentId: string, options?: Record<string, unknown>): Promise<any>;
    };
  }
  export default Razorpay;
}

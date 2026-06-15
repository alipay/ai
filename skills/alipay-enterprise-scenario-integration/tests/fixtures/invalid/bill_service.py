DETAIL_METHOD = "alipay.commerce.ec.consume.detail.query"
BATCH_METHOD = "alipay.commerce.ec.consume.detail.batchquery"
NOTIFY_METHOD = "alipay.commerce.ec.consume.change.notify"


def handle_bill_notification(pay_no):
    return {"method": NOTIFY_METHOD, "pay_no": pay_no}

DETAIL_METHOD = "alipay.commerce.ec.consume.detail.query"
BATCH_METHOD = "alipay.commerce.ec.consume.detail.batchquery"
NOTIFY_METHOD = "alipay.commerce.ec.consume.change.notify"
EXPENSE_TYPE = "TICKET"
EXPENSE_TYPE_SUB_CATEGORY = "TICKET"
ORDER_TYPE = "TICKET"


def handle_bill_notification(pay_no):
    return {
        "method": NOTIFY_METHOD,
        "pay_no": pay_no,
        "expense_type": EXPENSE_TYPE,
        "expense_type_sub_category": EXPENSE_TYPE_SUB_CATEGORY,
        "order_type": ORDER_TYPE,
    }

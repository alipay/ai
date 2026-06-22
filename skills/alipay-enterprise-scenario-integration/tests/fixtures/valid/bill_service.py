DETAIL_METHOD = "alipay.commerce.ec.consume.detail.query"
BATCH_METHOD = "alipay.commerce.ec.consume.detail.batchquery"
NOTIFY_METHOD = "alipay.commerce.ec.consume.change.notify"
EXPENSE_TYPE = "METRO"
EXPENSE_TYPE_SUB_CATEGORY = "METRO"
SCENE_CODE = "METRO"
ORDER_TYPE = "METRO"


def handle_bill_notification(pay_no, payload):
    if payload.get("scene_code") != SCENE_CODE:
        return False
    if payload.get("order_type") != ORDER_TYPE:
        return False
    return {
        "method": NOTIFY_METHOD,
        "pay_no": pay_no,
        "expense_type": EXPENSE_TYPE,
        "expense_type_sub_category": EXPENSE_TYPE_SUB_CATEGORY,
        "scene_code": SCENE_CODE,
        "order_type": ORDER_TYPE,
    }

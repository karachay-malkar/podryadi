"""Contact unlock fee. Progressive marginal brackets, rounded to rubles."""
from decimal import Decimal, ROUND_HALF_UP


def fee_for(amount: int) -> int:
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise ValueError('Стоимость заказа должна быть положительной')
    if amount <= 5_000:
        fee = Decimal(100)
    elif amount <= 50_000:
        fee = Decimal(100) + Decimal(amount - 5_000) * Decimal('0.015')
    elif amount <= 500_000:
        fee = Decimal(775) + Decimal(amount - 50_000) * Decimal('0.01')
    else:
        fee = Decimal(5_275) + Decimal(amount - 500_000) * Decimal('0.005')
    return int(fee.quantize(Decimal('1'), rounding=ROUND_HALF_UP))

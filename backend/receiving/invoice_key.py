"""Structural checks of the NF-e access key (layout from the NF-e taxpayer manual).

Positions (0-based): cUF 0-1, AAMM 2-5, CNPJ/CPF 6-19, modelo 20-21, série 22-24,
nNF 25-33, tpEmis 34, cNF 35-42, cDV 43. Authenticity is still not validated.
"""

from itertools import cycle

from rest_framework.exceptions import ValidationError

KEY_LENGTH = 44
NUMBER_SLICE = slice(25, 34)


def check_digit(first_43):
    total = sum(int(d) * w for d, w in zip(reversed(first_43), cycle(range(2, 10))))
    remainder = total % 11
    return 0 if remainder < 2 else 11 - remainder


def number_from_key(access_key):
    return int(access_key[NUMBER_SLICE])


def same_number(left, right):
    left, right = left.strip(), right.strip()
    if left.isdigit() and right.isdigit():
        return int(left) == int(right)
    return left == right


def validate_invoice_identity(number, access_key):
    """Reject a key that is malformed or whose embedded number differs from the invoice number."""
    if not access_key:
        return
    if len(access_key) != KEY_LENGTH or not access_key.isdigit():
        raise ValidationError({"access_key": "A chave de acesso deve ter 44 dígitos."})
    if check_digit(access_key[:43]) != int(access_key[43]):
        raise ValidationError(
            {"access_key": "Chave de acesso inválida: dígito verificador não confere."}
        )
    if not number:
        return
    if not number.strip().isdigit():
        raise ValidationError({"number": "O número da nota deve conter somente dígitos."})
    embedded = number_from_key(access_key)
    if int(number) != embedded:
        raise ValidationError(
            {
                "number": f"Número da nota ({int(number)}) não confere com a chave de acesso, "
                f"que indica a nota {embedded}."
            }
        )

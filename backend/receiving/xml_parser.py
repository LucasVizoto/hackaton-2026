"""Deterministic extraction only. No fiscal-signature or authenticity validation."""

from decimal import Decimal, InvalidOperation

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from rest_framework.exceptions import ValidationError

MAX_XML_BYTES = 5 * 1024 * 1024


def parse_invoice_xml(content):
    if len(content) > MAX_XML_BYTES:
        raise ValidationError("XML acima do limite de 5 MB.")
    try:
        root = ElementTree.fromstring(
            content, forbid_dtd=True, forbid_entities=True, forbid_external=True
        )
    except ElementTree.ParseError, DefusedXmlException, ValueError:
        raise ValidationError("XML inválido. DTD e entidades não são permitidos.") from None
    nodes = list(root.iter())
    if len(nodes) > 30000:
        raise ValidationError("XML com quantidade excessiva de elementos.")
    for node in nodes:
        node.tag = node.tag.rsplit("}", 1)[-1]
    info = root if root.tag == "infNFe" else root.find(".//infNFe")
    if info is None:
        raise ValidationError("O XML não contém uma NF-e reconhecível (infNFe).")

    def value(node, path):
        found = node.find(path)
        return (found.text or "").strip() if found is not None else ""

    def number(text):
        if not text:
            return None
        try:
            result = Decimal(text)
            if (
                not result.is_finite()
                or result < 0
                or result >= Decimal("1000000000000000")
                or abs(result.as_tuple().exponent) > 6
            ):
                raise InvalidOperation
            return str(result)
        except InvalidOperation:
            raise ValidationError("Quantidade ou valor numérico inválido no XML.") from None

    access_key = info.attrib.get("Id", "").removeprefix("NFe")
    if access_key and (len(access_key) != 44 or not access_key.isdigit()):
        raise ValidationError("Chave declarada inválida: são necessários 44 dígitos.")
    items = []
    for position, detail in enumerate(info.findall("det"), 1):
        product = detail.find("prod")
        if product is None:
            continue
        items.append(
            {
                "position": position,
                "supplier_code": value(product, "cProd")[:100],
                "description": value(product, "xProd")[:400],
                "unit": value(product, "uCom")[:30],
                "quantity": number(value(product, "qCom")),
                "unit_value": number(value(product, "vUnCom")),
            }
        )
    if len(items) > 1000:
        raise ValidationError("NF-e acima do limite de 1.000 itens.")
    volumes = [
        {
            "quantity": number(value(volume, "qVol")),
            "species": value(volume, "esp"),
            "net_weight": number(value(volume, "pesoL")),
            "gross_weight": number(value(volume, "pesoB")),
        }
        for volume in info.findall("transp/vol")
    ]
    return {
        "access_key": access_key,
        "number": value(info, "ide/nNF")[:50],
        "issued_at": value(info, "ide/dhEmi") or value(info, "ide/dEmi"),
        "issuer": {
            "name": value(info, "emit/xNome"),
            "document": value(info, "emit/CNPJ") or value(info, "emit/CPF"),
        },
        "items": items,
        "volumes": volumes,
        "warning": "Dados declarados pelo emitente; acondicionamento e destinos exigem confirmação. Códigos de itens são do fornecedor. Autenticidade fiscal não validada.",
    }

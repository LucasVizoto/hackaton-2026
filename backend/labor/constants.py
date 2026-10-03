from decimal import Decimal

FLOOR = Decimal("90.1731")
RATE_TABLE = (
    ("SACARIA_25", "Sacaria malas c/25", "0.1824"),
    ("SACARIA_40", "Sacaria malas c/40", "0.2635"),
    ("SACARIA_50", "Sacaria malas c/50", "0.3224"),
    ("FARDO_250", "Sacaria fardo c/250", "1.1780"),
    ("FARDO_500", "Sacaria fardo c/500", "2.3561"),
    ("PECAS", "Peças", "0.3387"),
    ("MAQUINAS", "Máquinas/equipamentos", "0.3224"),
    ("AGROQUIMICO", "Agroquímico", "0.3224"),
    ("FERTILIZANTES", "Fertilizantes", "0.3224"),
    ("SEMENTES", "Sementes", "0.3224"),
    ("MEDICAMENTOS", "Medicamentos", "0.3387"),
    ("ALIMENTACAO_ANIMAL", "Alimentação animal", "0.3387"),
    ("ACESSORIOS", "Acessórios agropecuários", "0.3224"),
    ("SERVICOS_DIVERSOS", "Serviços diversos", "0.3224"),
)
CATEGORY_CHOICES = [(code, label) for code, label, _ in RATE_TABLE]
LABELS = dict(CATEGORY_CHOICES)
PRICES = {code: Decimal(price) for code, _, price in RATE_TABLE}

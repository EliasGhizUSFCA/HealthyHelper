"""Re-run attribute/claim extraction on stored products after extraction rules change (no network).

    python -m app.recommendations.catalog.reextract
"""

from __future__ import annotations

from app.config import get_settings
from app.recommendations.catalog.attributes import extract
from app.recommendations.catalog.store import CatalogStore, products
from app.schemas.catalog import CatalogProduct


def main() -> None:
    store = CatalogStore(get_settings())
    changed = 0
    with store.engine.begin() as c:
        for pid, data in c.execute(products.select().with_only_columns(products.c.product_id, products.c.data)).all():
            p = CatalogProduct.model_validate(data)
            attrs, claims = extract(p.name, p.description, p.usage, p.ingredients)
            if attrs != p.attributes or claims != p.claims:
                p.attributes, p.claims = attrs, claims
                c.execute(products.update().where(products.c.product_id == pid).values(data=p.model_dump()))
                changed += 1
    print(f"re-extracted attributes; {changed} products changed")


if __name__ == "__main__":
    main()

import type { ReactNode } from 'react';

/** Размеры каталога определяет содержимое, без измерений окна на клиенте. */
export function CatalogLayout({ children }: { children: ReactNode }) {
  return <section className="gf-catalog">{children}</section>;
}

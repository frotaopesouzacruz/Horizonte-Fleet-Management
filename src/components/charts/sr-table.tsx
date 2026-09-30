import * as React from "react";

export interface SrTableProps {
  caption: string;
  columns: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
}

/**
 * O que o gráfico mostra, em linhas e colunas — para quem não enxerga o desenho.
 * O `sr-only` fica num div: uma tabela ignora a largura de 1 px e esticaria a
 * página no celular.
 */
export function SrTable({ caption, columns, rows }: SrTableProps) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

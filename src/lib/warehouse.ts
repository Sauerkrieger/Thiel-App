/**
 * Zentrale Lager-Konstanten (Start/Ziel der Rundtour).
 *
 * Ausgelagert aus dem Optimizer, damit auch die Tour-API (Kartenanzeige)
 * auf dieselben Werte zugreifen kann, ohne den ganzen Optimizer zu laden.
 */

export const WAREHOUSE_NAME = "Thiel Dienstleistungen";
export const WAREHOUSE_ADDRESS =
  process.env.WAREHOUSE_ADDRESS ??
  "Sartoriusstraße 14, 97072 Würzburg";

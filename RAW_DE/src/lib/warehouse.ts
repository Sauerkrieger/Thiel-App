/**
 * Zentrale Lager-Konstanten (Start/Ziel der Rundtour).
 *
 * Ausgelagert aus dem Optimizer, damit auch die Tour-API (Kartenanzeige)
 * auf dieselben Werte zugreifen kann, ohne den ganzen Optimizer zu laden.
 */

import { COMPANY_NAME } from "@/lib/company";

/** Name des Lagers in der App (Default: Firmenname). */
export const WAREHOUSE_NAME =
  process.env.NEXT_PUBLIC_WAREHOUSE_NAME?.trim() || COMPANY_NAME;

/**
 * Adresse des Lagers. `NEXT_PUBLIC_*` wird auch im Browser benötigt
 * (Navigationsziel der Tour), `WAREHOUSE_ADDRESS` gilt serverseitig.
 */
export const WAREHOUSE_ADDRESS =
  process.env.NEXT_PUBLIC_WAREHOUSE_ADDRESS?.trim() ||
  process.env.WAREHOUSE_ADDRESS?.trim() ||
  "Musterstraße 1, 12345 Musterstadt";

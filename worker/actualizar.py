"""Actualiza el Módulo de Auditores: ejecuta las dos consultas, arma la tabla y la sube a Supabase (proyecto DAC).

Uso:
  actualizar.py --una-vez      ejecuta una actualización
  actualizar.py --escuchar     queda atendiendo el botón "Actualizar" de la app (y actualiza solo cada N minutos)
  actualizar.py --local        genera public/local/datos.json para revisar la app sin Supabase
"""
import argparse
import json
import logging
import sys
import time as reloj
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from auditores.conexion import RAIZ, consultar, leer_config  # noqa: E402

LOG = RAIZ / "worker" / "logs" / "actualizar.log"
# Último registro de cada estado por solicitud: (estado, columna de fecha, columna de usuario)
ESTADOS = [("APROBADO INFORMA", "fecha_aprobado_informa", None),
           ("FORMALIZADO", "fecha_formalizado", "usuario_formaliza"),
           ("EXPEDIENTE DIGITALIZADO", "fecha_digitalizado", "usuario_digitaliza"),
           ("AUDITADO", "fecha_auditado", "usuario_audita")]


def _texto(v):
    if v is None or v is pd.NaT or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d %H:%M:%S")  # hora local del DWH, sin zona
    if hasattr(v, "item"):
        return v.item()
    return v


def procesar(cfg: dict) -> list[dict]:
    sql = {k: (RAIZ / v).read_text(encoding="utf-8-sig") for k, v in cfg["consultas"].items()}
    t0 = reloj.time()
    pri = consultar(cfg["servidor"], sql["principal"])
    est = consultar(cfg["servidor"], sql["estados"])
    logging.info("Consultas: principal %s filas, estados %s filas (%.0f s)", len(pri), len(est), reloj.time() - t0)
    if pri.empty:
        return []
    est["FECHA MODIFICACION"] = pd.to_datetime(est["FECHA MODIFICACION"])
    desde, hasta = pd.Timestamp(est["DESDE"].iloc[0]), pd.Timestamp(est["HASTA"].iloc[0])
    # APROBADO INFORMA solo dentro de la ventana, como en "Consulta Aprobado Informa"
    ai = est["ESTADO"].eq("APROBADO INFORMA")
    est = est[~ai | est["FECHA MODIFICACION"].between(desde, hasta, inclusive="left")]
    # El último de cada estado; con la misma hora queda el que viene después en el orden de la consulta
    ult = est.reset_index().sort_values(["FECHA MODIFICACION", "index"]).groupby(["SOLICITUD", "ESTADO"]).last()

    df = pri.rename(columns={"Num_Solicitud": "solicitud", "Llave": "llave", "Tipo_Credito": "tipo_credito",
                             "Promotor": "promotor", "Estado": "estado", "Categorizacion": "categorizacion"})
    df["solicitud"] = df["solicitud"].astype("int64")
    for estado, col_fecha, col_usuario in ESTADOS:
        u = ult.xs(estado, level="ESTADO") if estado in ult.index.get_level_values("ESTADO") else ult.iloc[0:0].droplevel(1)
        u.index = u.index.astype("int64")
        df[col_fecha] = df["solicitud"].map(u["FECHA MODIFICACION"])
        if col_usuario:
            df[col_usuario] = df["solicitud"].map(u["USUARIO MODIFICA"])
    df["periodo"] = df["fecha_aprobado_informa"].dt.strftime("%Y-%m")
    sin = df["periodo"].isna().sum()
    if sin:
        logging.warning("%s solicitudes sin APROBADO INFORMA en la ventana (no se cargan)", sin)
        df = df[df["periodo"].notna()]
    return [{k: _texto(v) for k, v in r.items()} for r in df.to_dict("records")]


def actualizar_nube(cfg: dict, sb, pedido: int | None = None):
    ahora = lambda: datetime.now().astimezone().isoformat()
    if pedido:
        sb.actualizar("aud_actualizaciones", f"id=eq.{pedido}", {"estado": "procesando", "iniciado_en": ahora()})
    try:
        filas = procesar(cfg)
        n = sb.rpc("aud_cargar", {"p_filas": filas})
        msg = f"{n} solicitudes cargadas"
        logging.info(msg)
        if pedido:
            sb.actualizar("aud_actualizaciones", f"id=eq.{pedido}", {"estado": "ok", "terminado_en": ahora(), "mensaje": msg})
    except Exception as e:
        logging.exception("Error en la actualización")
        if pedido:
            sb.actualizar("aud_actualizaciones", f"id=eq.{pedido}",
                          {"estado": "error", "terminado_en": ahora(), "mensaje": str(e)[:500]})
        raise


def escuchar(cfg: dict):
    from auditores.nube import Supabase
    ultima = 0.0
    cada = float(cfg.get("cada_minutos", 60)) * 60
    while True:
        try:
            sb = Supabase(cfg["supabase"])  # nuevo token en cada vuelta: no caduca aunque quede días encendido
            pend = sb.leer("aud_actualizaciones", "&estado=eq.pendiente&order=id")
            if pend:
                for p in pend[1:]:  # varios clics seguidos se atienden con una sola actualización
                    sb.actualizar("aud_actualizaciones", f"id=eq.{p['id']}",
                                  {"estado": "ok", "mensaje": "Atendida junto con la solicitud anterior"})
                actualizar_nube(cfg, sb, pend[0]["id"])
                ultima = reloj.time()
            elif cada > 0 and reloj.time() - ultima >= cada:
                actualizar_nube(cfg, sb)
                ultima = reloj.time()
        except Exception:
            logging.exception("Vuelta con error; se reintenta")
        reloj.sleep(20)


def local(cfg: dict):
    destino = RAIZ / "public" / "local" / "datos.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps({"solicitudes": procesar(cfg),
                                   "ultima_actualizacion": datetime.now().astimezone().isoformat()},
                                  ensure_ascii=False), encoding="utf-8")
    logging.info("Escrito %s", destino)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    for op in ("una-vez", "escuchar", "local"):
        g.add_argument(f"--{op}", action="store_true")
    a = ap.parse_args()
    LOG.parent.mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(LOG, encoding="utf-8"), logging.StreamHandler()])
    cfg = leer_config()
    if a.local:
        local(cfg)
    elif a.una_vez:
        from auditores.nube import Supabase
        actualizar_nube(cfg, Supabase(cfg["supabase"]))
    else:
        escuchar(cfg)


if __name__ == "__main__":
    main()

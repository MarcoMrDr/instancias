'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { useCart } from '@/components/CartProvider';
import { MANUAL_EXTRAS } from '@/lib/manualProducts';
import type { Evento, ExtraProducto } from '@/lib/types';

const FETCH_TIMEOUT_MS = 10000;

export default function EventosPage() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(true);
  const { addEventTicketToCart, addExtraToCart } = useCart();

  const fetchEventos = useCallback(async () => {
    if (!supabase) {
      setMensaje('Configura Supabase para visualizar eventos.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setMensaje('');

    try {
      const queryPromise = supabase
        .from('eventos')
        .select('id, titulo, descripcion, fecha, precio, limite_boletos')
        .order('fecha', { ascending: true });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tiempo de espera agotado al cargar eventos.')), FETCH_TIMEOUT_MS);
      });

      const result = await Promise.race([queryPromise, timeoutPromise]);
      const { data, error } = result as Awaited<typeof queryPromise>;

      if (error) {
        setMensaje(`Error: ${error.message}`);
        return;
      }

      const rows = (data as Evento[]) ?? [];
      setEventos(rows);
      if (rows.length === 0) {
        setMensaje('No hay eventos registrados.');
      }
    } catch (error) {
      setMensaje(`No se pudieron cargar eventos: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEventos();
  }, [fetchEventos]);

  useEffect(() => {
    const onFocus = () => {
      fetchEventos();
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchEventos]);

  const onAddTicket = (evento: Evento) => {
    if (evento.limite_boletos <= 0) {
      setMensaje('Este evento ya no tiene boletos disponibles.');
      return;
    }

    const result = addEventTicketToCart(evento, 1);
    setMensaje(result);
  };

  const onAddExtra = (extra: ExtraProducto) => {
    const result = addExtraToCart(extra, 1);
    setMensaje(result);
  };

  return (
    <section className="card">
      <h2>Visualizar eventos</h2>
      {!isSupabaseConfigured && (
        <p className="warning">Faltan variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.</p>
      )}

      <button type="button" className="secondary" onClick={fetchEventos} disabled={loading}>
        {loading ? 'Cargando...' : 'Recargar eventos'}
      </button>

      {mensaje && <p>{mensaje}</p>}
      {eventos.length > 0 && (
        <ul className="event-list">
          {eventos.map((evento) => (
            <li key={evento.id}>
              <h3>{evento.titulo}</h3>
              <p>{evento.descripcion}</p>
              <small>Fecha: {new Date(evento.fecha).toLocaleDateString('es-ES')}</small>
              <p>Precio boleto: ${evento.precio.toFixed(2)}</p>
              <p>Boletos disponibles: {evento.limite_boletos}</p>
              <button type="button" onClick={() => onAddTicket(evento)} disabled={evento.limite_boletos <= 0}>
                {evento.limite_boletos <= 0 ? 'Agotado' : 'Agregar 1 boleto al carrito'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: '2rem' }}>Productos extras</h3>
      <p>Estos productos se agregan manualmente en <code>lib/manualProducts.ts</code>.</p>
      <ul className="event-list">
        {MANUAL_EXTRAS.map((extra) => (
          <li key={extra.id}>
            <h3>{extra.nombre}</h3>
            <p>Precio: ${extra.precio.toFixed(2)}</p>
            <p>Disponibles: {extra.stock}</p>
            <button type="button" onClick={() => onAddExtra(extra)}>
              Agregar al carrito
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

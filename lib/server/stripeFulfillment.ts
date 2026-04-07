import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

type CompactItem = {
  itemId: string;
  tipo: 'boleto' | 'extra';
  cantidad: number;
};

export async function fulfillCheckoutSession(session: Stripe.Checkout.Session) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  }

  if (!session.id) {
    throw new Error('Session sin id.');
  }

  const cartRaw = session.metadata?.cart;
  if (!cartRaw) {
    throw new Error('checkout.session.completed sin metadata cart.');
  }

  let items: CompactItem[] = [];
  try {
    items = JSON.parse(cartRaw) as CompactItem[];
  } catch {
    throw new Error('Metadata cart inválida.');
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });

  const { data: processed } = await supabaseAdmin
    .from('stripe_sessions_procesadas')
    .select('session_id')
    .eq('session_id', session.id)
    .maybeSingle();

  if (processed) {
    return { duplicate: true };
  }

  for (const item of items) {
    if (item.tipo !== 'boleto') continue;

    const eventoId = Number(item.itemId.replace('boleto-', ''));
    if (!Number.isFinite(eventoId)) {
      throw new Error(`Item boleto inválido: ${item.itemId}`);
    }

    const { data: discountOk, error: discountError } = await supabaseAdmin.rpc('descontar_boletos', {
      p_evento_id: eventoId,
      p_cantidad: item.cantidad
    });

    if (discountError) {
      throw new Error(`Error al descontar boletos del evento ${eventoId}: ${discountError.message}`);
    }

    if (!discountOk) {
      throw new Error(
        `No se pudo descontar boletos del evento ${eventoId} (stock insuficiente o evento inexistente).`
      );
    }
  }

  const { error: insertSessionError } = await supabaseAdmin
    .from('stripe_sessions_procesadas')
    .insert({ session_id: session.id });

  if (insertSessionError) {
    throw new Error(`No se pudo registrar sesión procesada: ${insertSessionError.message}`);
  }

  return { duplicate: false };
}

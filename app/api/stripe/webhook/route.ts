import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type CompactItem = {
  itemId: string;
  tipo: 'boleto' | 'extra';
  cantidad: number;
};

export async function POST(request: Request) {
  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    return NextResponse.json(
      {
        error:
          'Faltan variables: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.'
      },
      { status: 500 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Falta header stripe-signature.' }, { status: 400 });
  }

  const stripe = new Stripe(stripeSecretKey);
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);
  } catch (error) {
    return NextResponse.json(
      { error: `Firma inválida de webhook: ${(error as Error).message}` },
      { status: 400 }
    );
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (!session.id) {
    return NextResponse.json({ error: 'Session sin id.' }, { status: 400 });
  }

  const cartRaw = session.metadata?.cart;
  if (!cartRaw) {
    return NextResponse.json({ error: 'checkout.session.completed sin metadata cart.' }, { status: 400 });
  }

  let items: CompactItem[] = [];
  try {
    items = JSON.parse(cartRaw) as CompactItem[];
  } catch {
    return NextResponse.json({ error: 'Metadata cart inválida.' }, { status: 400 });
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
    return NextResponse.json({ received: true, duplicate: true });
  }

  for (const item of items) {
    if (item.tipo !== 'boleto') continue;

    const eventoId = Number(item.itemId.replace('boleto-', ''));
    if (!Number.isFinite(eventoId)) {
      return NextResponse.json({ error: `Item boleto inválido: ${item.itemId}` }, { status: 400 });
    }

    const { data: discountOk, error: discountError } = await supabaseAdmin.rpc('descontar_boletos', {
      p_evento_id: eventoId,
      p_cantidad: item.cantidad
    });

    if (discountError) {
      return NextResponse.json(
        { error: `Error al descontar boletos del evento ${eventoId}: ${discountError.message}` },
        { status: 500 }
      );
    }

    if (!discountOk) {
      return NextResponse.json(
        { error: `No se pudo descontar boletos del evento ${eventoId} (stock insuficiente o evento inexistente).` },
        { status: 409 }
      );
    }
  }

  const { error: insertSessionError } = await supabaseAdmin
    .from('stripe_sessions_procesadas')
    .insert({ session_id: session.id });

  if (insertSessionError) {
    return NextResponse.json(
      { error: `No se pudo registrar sesión procesada: ${insertSessionError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

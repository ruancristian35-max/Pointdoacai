import React, { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createRoot } from 'react-dom/client';
import { ShoppingBag, Plus, Minus, X, MapPin, Truck, Tag, IceCreamBowl, CheckCircle2 } from 'lucide-react';
import './style.css';
const products = [{ id: 1, name: 'Açaí Tradicional', size: '300 ml', price: 14.9, old: 18.9, emoji: '🥣', desc: 'Açaí cremoso com banana e granola', cat: 'Açaís' }, { id: 2, name: 'Açaí Especial', size: '500 ml', price: 21.9, old: 26.9, emoji: '🍓', desc: 'Açaí com morango, leite em pó e leite condensado', cat: 'Açaís' }, { id: 3, name: 'Açaí Família', size: '1 litro', price: 39.9, old: 49.9, emoji: '🫐', desc: 'Muito açaí para dividir com quem você ama', cat: 'Combos' }, { id: 4, name: 'Combo Casal', size: '2 × 500 ml', price: 39.9, old: 49.8, emoji: '💜', desc: 'Dois açaís caprichados com 2 adicionais cada', cat: 'Combos' }, { id: 5, name: 'Copo Tropical', size: '400 ml', price: 19.9, old: null, emoji: '🍌', desc: 'Açaí com banana, morango e granola', cat: 'Açaís' }, { id: 6, name: 'Milk-shake de Açaí', size: '400 ml', price: 17.9, old: null, emoji: '🥤', desc: 'Cremoso, geladinho e irresistível', cat: 'Bebidas' }];
const extras = [['Leite em pó', 3], ['Morango', 4], ['Banana', 2], ['Nutella', 6], ['Granola', 2], ['Leite condensado', 3]];
const money = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function App() {
    const [cat, setCat] = useState('Todos'), [cart, setCart] = useState([]), [open, setOpen] = useState(false), [checkout, setCheckout] = useState(false), [selected, setSelected] = useState(null), [chosen, setChosen] = useState([]), [qty, setQty] = useState(1), [form, setForm] = useState({ name: '', phone: '', email: '', cpf: '', address: '', delivery: 'Entrega', payment: 'Pix' }), [notice, setNotice] = useState(''), [pix, setPix] = useState(null), [receipt, setReceipt] = useState(null), [submitting, setSubmitting] = useState(false), [blocked, setBlocked] = useState(false), [copied, setCopied] = useState(false), requestLock = useRef(false);
    const total = cart.reduce((a, i) => a + i.price * i.qty, 0), count = cart.reduce((a, i) => a + i.qty, 0);
    function add() { const price = selected.price + chosen.reduce((a, e) => a + e[1], 0); setCart(c => [...c, { key: Date.now() + Math.random(), name: selected.name, extras: chosen.map(e => e[0]), price, qty }]); setSelected(null); setChosen([]); setQty(1); setNotice('Produto adicionado ao carrinho!'); setTimeout(() => setNotice(''), 2500); }
    function update(key, d) { setCart(c => c.map(i => i.key === key ? { ...i, qty: i.qty + d } : i).filter(i => i.qty > 0)); }
    async function order(e) {
        e.preventDefault();
        if (requestLock.current || blocked || pix || receipt)
            return;
        requestLock.current = true;
        setSubmitting(true);
        setNotice('');
        try {const chave = "pointdoacai_checkout_request_id";
let checkoutRequestId = sessionStorage.getItem(chave);

if (!checkoutRequestId) {
  checkoutRequestId = crypto.randomUUID();
  sessionStorage.setItem(chave, checkoutRequestId);
}const chave = "pointdoacai_checkout_request_id";
let checkoutRequestId = sessionStorage.getItem(chave);

if (!checkoutRequestId) {
  checkoutRequestId = crypto.randomUUID();
  sessionStorage.setItem(chave, checkoutRequestId);
}
            const r = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({checkout_request_id: checkoutRequestId,
    customer: form,
                    items: cart.map(({ name, extras, qty }) => ({ name, extras, qty }))
                })
            });
            const data = await r.json();
            if (!r.ok) {
                if (r.status >= 500)
                    setBlocked(true);
                throw Error(data.error || 'Não foi possível iniciar o pedido.');
            }
            if (data.pixPayload && typeof data.pixPayload === 'string' && data.orderId) {
                setPix({
                    payload: data.pixPayload,
                    orderId: data.orderId,
                    amount: typeof data.amount === 'number' ? data.amount : total,
                    status: 'awaiting_payment'
                });
                setCopied(false);
                setCheckout(false);
                setOpen(true);
            }
            else if (data.orderId && data.status === 'pending_payment') {
                setReceipt({ orderId: data.orderId, message: data.message || 'Pedido de teste registrado. Nenhum Pix foi gerado.' });
                setCheckout(false);
                setOpen(true);
            }
            else {
                setBlocked(true);
                throw Error('O servidor respondeu sem confirmar o pedido. Verifique o registro antes de tentar novamente.');
            }
        }
        catch (err) {
            if (err instanceof TypeError || err instanceof SyntaxError)
                setBlocked(true);
            setNotice(err.message || 'Falha no pedido. Verifique no Supabase antes de tentar novamente.');
        }
        finally {
            setSubmitting(false);
            requestLock.current = false;
        }
    }
    async function copyPix() {
        if (!pix?.payload)
            return;
        try {
            await navigator.clipboard.writeText(pix.payload);
            setCopied(true);
        }
        catch {
            setNotice('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.');
        }
    }
    function novoPedido() {sessionStorage.removeItem("pointdoacai_checkout_request_id");
        setPix(null);
        setReceipt(null);
        setBlocked(false);
        setCopied(false);
        setCart([]);
        setCheckout(false);
        setOpen(false);
        setNotice('');
        setForm({ name: '', phone: '', email: '', cpf: '', address: '', delivery: 'Entrega', payment: 'Pix' });
    }
    return <><header><div className="nav wrap"><a className="logo" href="#inicio"><span>🍇</span><span>POINT DO <b>AÇAÍ</b><small>SEU MOMENTO MAIS GOSTOSO</small></span></a><nav><a href="#cardapio">Cardápio</a><a href="#promocoes">Promoções</a><a href="#sobre">Sobre nós</a></nav><button className="cartbtn" onClick={() => setOpen(true)}><ShoppingBag size={19}/> Meu pedido <i>{count}</i></button></div></header><main id="inicio"><section className="hero"><div className="wrap hero-grid"><div><span className="eyebrow">💜 O SABOR QUE CONQUISTA</span><h1>Seu dia fica<br />melhor com <em>açaí!</em></h1><p>O açaí mais cremoso, com seus complementos favoritos. Monte do seu jeito e aproveite cada colherada!</p><div className="hero-actions"><a className="primary" href="#cardapio">Ver cardápio <span>↗</span></a><a className="secondary" href="#promocoes">🔥 Ver promoções</a></div><div className="benefits"><span>✓ Feito com carinho</span><span>✓ Combos especiais</span><span>✓ Peça online</span></div></div><div className="hero-art"><div className="glow"></div><div className="cup">🍧</div><div className="floating top">✨ 100% sabor</div><div className="floating bottom">💜 Feito pra você!</div></div></div></section><section className="perks wrap"><div>🚀 <span><b>Pedido fácil</b><small>Direto pelo site</small></span></div><div>🥣 <span><b>Açaí cremoso</b><small>Do jeitinho que você gosta</small></span></div><div>🎁 <span><b>Ofertas especiais</b><small>Economize nos combos</small></span></div></section><section className="wrap section" id="promocoes"><div className="section-head"><div><span className="kicker">OFERTAS IMPERDÍVEIS</span><h2>Promoções que dão <em>água na boca</em> 🔥</h2></div></div><div className="promo-grid"><div className="promo p1"><span>OFERTA DA CASA</span><h3>Combo Casal</h3><p>Dois açaís para compartilhar!</p><strong>{money(39.9)}</strong><button onClick={() => { setSelected(products[3]); document.getElementById('cardapio').scrollIntoView({ behavior: 'smooth' }); }}>Quero aproveitar ↗</button><span className="promo-emoji">💜</span></div><div className="promo p2"><span>MAIS PEDIDO</span><h3>Açaí Especial</h3><p>500 ml de pura felicidade</p><strong>{money(21.9)}</strong><button onClick={() => setSelected(products[1])}>Pedir agora ↗</button><span className="promo-emoji">🍓</span></div></div></section><section className="menu-section" id="cardapio"><div className="wrap section"><div className="section-head"><div><span className="kicker">ESCOLHA O SEU FAVORITO</span><h2>Nosso <em>cardápio</em> 🥣</h2><p>Sabores especiais preparados para você.</p></div></div><div className="filters">{['Todos', 'Açaís', 'Combos', 'Bebidas'].map(c => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}</div><div className="products">{products.filter(p => cat === 'Todos' || p.cat === cat).map(p => <article className="product" key={p.id}><div className="product-art"><span>{p.emoji}</span>{p.old && <b className="discount">OFERTA</b>}</div><div className="product-info"><span className="size">{p.size}</span><h3>{p.name}</h3><p>{p.desc}</p><div className="price-line"><div>{p.old && <del>{money(p.old)}</del>}<strong>{money(p.price)}</strong></div><button aria-label={'Adicionar ' + p.name} onClick={() => setSelected(p)}><Plus /></button></div></div></article>)}</div><p className="disclaimer">* Cardápio e valores ilustrativos. Atualize os produtos e preços antes de publicar a loja.</p></div></section><section id="sobre" className="about wrap"><div><span className="kicker">SOBRE NÓS</span><h2>Uma paixão chamada <em>açaí!</em></h2><p>No Point do Açaí, cada pedido é uma oportunidade de deixar seu dia mais gostoso. Escolha seus sabores, personalize e faça seu pedido em poucos cliques.</p></div><div className="about-icon">🍇💜</div></section></main><footer><div className="wrap foot"><div className="logo"><span>🍇</span><span>POINT DO <b>AÇAÍ</b></span></div><p>Seu ponto favorito de sabor 💜</p><small>© 2026 Point do Açaí. Todos os direitos reservados.</small></div></footer>{notice && <div className="toast">{notice}</div>}{selected && <div className="overlay" onClick={() => setSelected(null)}><div className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)}><X /></button><div className="modal-emoji">{selected.emoji}</div><h2>{selected.name}</h2><p>{selected.desc}</p><h3>Personalize seu açaí</h3><div className="extra-list">{extras.map(ex => <label key={ex[0]}><input type="checkbox" checked={chosen.some(x => x[0] === ex[0])} onChange={e => setChosen(c => e.target.checked ? [...c, ex] : c.filter(x => x[0] !== ex[0]))}/>{ex[0]} <b>+ {money(ex[1])}</b></label>)}</div><div className="modal-bottom"><div className="counter"><button onClick={() => setQty(Math.max(1, qty - 1))}><Minus size={16}/></button>{qty}<button onClick={() => setQty(qty + 1)}><Plus size={16}/></button></div><button className="primary" onClick={add}>Adicionar {money((selected.price + chosen.reduce((a, e) => a + e[1], 0)) * qty)}</button></div></div></div>}{open && <div className="overlay" onClick={() => setOpen(false)}><aside className="drawer" onClick={e => e.stopPropagation()}><div className="drawer-head"><h2><ShoppingBag /> Meu pedido</h2><button onClick={() => { setOpen(false); setCheckout(false); }}><X /></button></div>{pix ? <div className="checkout" style={{ display: 'grid', gap: 14 }}>
            <h3>Pagamento via Pix</h3>
            <p><b>Pedido:</b> {pix.orderId}</p>
            <p><b>Valor:</b> {money(pix.amount)}</p>
            <div style={{ background: '#fff', padding: 16, borderRadius: 12, display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={pix.payload} size={210} level="M" marginSize={2}/>
            </div>
            <label>Pix Copia e Cola
            <textarea readOnly rows={4} value={pix.payload} onFocus={e => e.target.select()} style={{ width: '100%', resize: 'vertical', overflowWrap: 'anywhere' }}/>
            </label>
            <button className="primary wide" type="button" onClick={copyPix}>{copied ? 'Código copiado!' : 'Copiar código Pix'}</button>
            <p className="disclaimer">Aguardando confirmação da Sunize. Não utilize outro meio de pagamento e não faça um segundo pedido para pagar novamente. O status ainda não é atualizado automaticamente nesta tela.</p>
            </div> : receipt ? <div className="checkout" style={{ display: 'grid', gap: 12 }}>
            <h3>Pedido de teste registrado</h3>
            <p>{receipt.message}</p>
            <p><b>Número do pedido:</b> {receipt.orderId}</p>
            <p className="disclaimer">Nenhuma cobrança Pix foi criada. Este pedido está aguardando pagamento no Supabase e não deve ser preparado como pago.</p>
            <button type="button" className="primary wide" onClick={novoPedido}>Começar outro pedido de teste</button>
            </div> : checkout ? <form onSubmit={order} className="checkout"><h3>Finalizar pedido</h3><label>Seu nome<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome completo"/></label><label>WhatsApp<input required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000"/></label><label>E-mail<input type="email" required autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="voce@email.com"/></label><label>CPF<input required inputMode="numeric" autoComplete="off" value={form.cpf} maxLength={14} onChange={e => setForm({ ...form, cpf: e.target.value.replace(/[^\d.-]/g, '') })} placeholder="000.000.000-00"/></label><label>Recebimento<select value={form.delivery} onChange={e => setForm({ ...form, delivery: e.target.value })}><option>Entrega</option><option>Retirada</option></select></label>{form.delivery === 'Entrega' && <label>Endereço de entrega<input required value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Rua, número, bairro e referência"/></label>}<label>Pagamento<input readOnly value="Pix (exclusivo)"/></label><p className="disclaimer">MODO DE TESTE: enquanto os pagamentos estiverem desativados no servidor, não será criado nenhum Pix. Não realize pagamentos até concluirmos os testes. Frete ainda não incluído.</p>{blocked && <p className="disclaimer" role="alert">O resultado da última tentativa é incerto. Confira o pedido no Supabase antes de tentar novamente. Evite gerar cobranças duplicadas.</p>}<button className="primary wide" disabled={submitting || blocked || cart.length === 0} type="submit">{submitting ? 'Enviando pedido...' : `Finalizar pedido · ${money(total)}`}</button><button type="button" className="back" onClick={() => setCheckout(false)}>← Voltar ao carrinho</button></form> : <><div className="cart-items">{cart.length === 0 ? <div className="empty"><IceCreamBowl size={55}/><h3>Seu carrinho está vazio</h3><p>Que tal escolher um açaí delicioso?</p><button className="primary" onClick={() => setOpen(false)}>Ver cardápio</button></div> : cart.map(i => <div className="cart-item" key={i.key}><div><b>{i.name}</b><small>{i.extras.join(', ') || 'Sem adicionais'}</small><strong>{money(i.price * i.qty)}</strong></div><div className="counter"><button onClick={() => update(i.key, -1)}><Minus size={15}/></button>{i.qty}<button onClick={() => update(i.key, 1)}><Plus size={15}/></button></div></div>)}</div>{cart.length > 0 && <div className="drawer-bottom"><div><span>Subtotal</span><b>{money(total)}</b></div><small>Entrega calculada após confirmação do endereço.</small><button className="primary wide" onClick={() => setCheckout(true)}>Finalizar pedido →</button></div>}</>}</aside></div>}</>;
}
;
createRoot(document.getElementById('root')).render(<App />);

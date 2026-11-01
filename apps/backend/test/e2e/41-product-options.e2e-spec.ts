/**
 * Product option groups and modifiers over real HTTP. The pricing model is `unit = product price + Σ price deltas of the selected
 * values` and it is computed ONLY on the server. These tests pin: several independent groups on one product (single-choice and
 * multiple-choice, required and optional), the validation the server applies, that the client can never send a price, and that
 * the chosen modifiers and their prices are snapshotted on the order.
 *
 * (The "Beit El Sharqeya grilled chicken: EGP 90 → two for EGP 270" report was DATA: the size options had been written as absolute
 * prices on a base price that already was the whole chicken. See the first test.)
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — product options', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  const home = { lat: 30.425, lng: 31.565 };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Options Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  /** There is no admin API for options yet (they are seeded / imported); the fixture writes the same rows the seed does. */
  async function addOption(productId: string, name: string, flags: { required: boolean; multiple: boolean }, values: Array<[string, number]>): Promise<{ id: string; values: string[] }> {
    const [opt] = await world.ds.query('INSERT INTO product_options (product_id, name, is_required, allows_multiple) VALUES ($1, $2, $3, $4) RETURNING id', [productId, name, flags.required, flags.multiple]);
    const ids: string[] = [];
    for (const [valueName, delta] of values) {
      const [v] = await world.ds.query('INSERT INTO product_option_values (option_id, name, price_delta_minor) VALUES ($1, $2, $3) RETURNING id', [opt.id, valueName, delta]);
      ids.push(v.id);
    }
    return { id: opt.id, values: ids };
  }
  const add = (c: Actor, productId: string, body: Record<string, unknown>) => world.api('post', '/cart/items', { token: c.accessToken, body: { productId, ...body } });

  it('the grilled-chicken fixture, corrected: one whole chicken = EGP 90, two = EGP 180 (deltas are FROM the base price, not absolute prices)', async () => {
    const chicken = await s.product(vendor, { name: 'Grilled Chicken', priceMinor: 9000 });
    const size = await addOption(chicken.id, 'Size', { required: true, multiple: false }, [['Whole chicken', 0], ['Two whole chickens', 9000]]);
    const c = await s.customer();
    const one = expectData<any>(await add(c, chicken.id, { quantity: 1, selectedOptionValueIds: [size.values[0]] }), 201);
    expect(one.groups[0].items[0]).toMatchObject({ unitPriceMinor: 9000, lineTotalMinor: 9000 });
    await world.api('delete', '/cart', { token: c.accessToken });
    const two = expectData<any>(await add(c, chicken.id, { quantity: 1, selectedOptionValueIds: [size.values[1]] }), 201);
    expect(two.groups[0].items[0]).toMatchObject({ unitPriceMinor: 18000, lineTotalMinor: 18000 });
    await world.api('delete', '/cart', { token: c.accessToken });
    const twoPieces = expectData<any>(await add(c, chicken.id, { quantity: 2, selectedOptionValueIds: [size.values[0]] }), 201);
    expect(twoPieces.groups[0].items[0].lineTotalMinor).toBe(18000); // quantity 2 of the 90 chicken
  });

  it('the data mistake itself is reproducible, and is what produced 270: base 90 + "absolute" delta 180 = 270', async () => {
    const wrong = await s.product(vendor, { name: 'Wrong Chicken', priceMinor: 9000 });
    const size = await addOption(wrong.id, 'Size', { required: true, multiple: false }, [['Whole chicken', 9000], ['Two whole chickens', 18000]]);
    const c = await s.customer();
    const cart = expectData<any>(await add(c, wrong.id, { quantity: 1, selectedOptionValueIds: [size.values[1]] }), 201);
    expect(cart.groups[0].items[0].unitPriceMinor).toBe(27000); // the server did exactly what the data said
  });

  describe('several independent groups on one product', () => {
    let pizza: { id: string };
    let size: { id: string; values: string[] };
    let toppings: { id: string; values: string[] };
    let sauce: { id: string; values: string[] };
    beforeAll(async () => {
      pizza = await s.product(vendor, { name: 'Pizza', priceMinor: 12000 });
      size = await addOption(pizza.id, 'Size', { required: true, multiple: false }, [['Small', 0], ['Large', 6000]]); // required, single-choice (radio)
      toppings = await addOption(pizza.id, 'Toppings', { required: false, multiple: true }, [['Olives', 800], ['Cheese', 1500], ['Mushrooms', 1000]]); // optional, multiple (checkboxes)
      sauce = await addOption(pizza.id, 'Sauce', { required: true, multiple: true }, [['Garlic', 0], ['Ketchup', 0], ['Ranch', 300]]); // required, multiple
    });

    it('the server prices base + every selected value across ALL groups, per unit, then × quantity', async () => {
      const c = await s.customer();
      const cart = expectData<any>(
        await add(c, pizza.id, { quantity: 2, selectedOptionValueIds: [size.values[1], toppings.values[0], toppings.values[1], sauce.values[0], sauce.values[2]] }),
        201,
      );
      const item = cart.groups[0].items[0];
      expect(item.unitPriceMinor).toBe(12000 + 6000 + 800 + 1500 + 0 + 300); // 20600
      expect(item.lineTotalMinor).toBe(2 * 20600);
      expect(item.selectedOptionValues.map((v: any) => [v.name, v.priceDeltaMinor]).sort()).toEqual([['Cheese', 1500], ['Garlic', 0], ['Large', 6000], ['Olives', 800], ['Ranch', 300]].sort());
    });

    it('the order snapshots the chosen modifiers with their prices, and totals equal the server calculation', async () => {
      const c = await s.customer();
      expectData(await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0], sauce.values[1], toppings.values[2]] }), 201);
      const order = await s.checkout(c, home);
      expect(order.subtotalMinor).toBe(12000 + 0 + 0 + 1000);
      const rows = await world.ds.query('SELECT options_snapshot FROM order_items oi JOIN order_vendor_segments s ON s.id = oi.order_vendor_segment_id WHERE s.order_id = $1', [order.id]);
      const stored = rows[0].options_snapshot as Array<{ name: string; valueName: string; priceDeltaMinor: number }>;
      expect(stored.map((o) => [o.name, o.valueName, o.priceDeltaMinor]).sort()).toEqual([['Sauce', 'Ketchup', 0], ['Size', 'Small', 0], ['Toppings', 'Mushrooms', 1000]].sort());
    });

    it('a required group without a selection is refused (OPTION_REQUIRED) — for each required group', async () => {
      const c = await s.customer();
      const noSize = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [sauce.values[0]] });
      expect(noSize.status).toBe(400);
      expect(noSize.body.error.details).toMatchObject({ code: 'OPTION_REQUIRED', optionId: size.id });
      const noSauce = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0]] });
      expect(noSauce.status).toBe(400);
      expect(noSauce.body.error.details).toMatchObject({ code: 'OPTION_REQUIRED', optionId: sauce.id });
    });

    it('a single-choice group refuses two values (INVALID_OPTION_SELECTION); a multiple-choice group accepts several', async () => {
      const c = await s.customer();
      const two = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0], size.values[1], sauce.values[0]] });
      expect(two.status).toBe(400);
      expect(two.body.error.details).toMatchObject({ code: 'INVALID_OPTION_SELECTION', optionId: size.id });
      const many = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0], sauce.values[0], sauce.values[1], sauce.values[2], ...toppings.values] });
      expect(many.status).toBe(201);
    });

    it("a value that belongs to another product (or does not exist) is refused, and the client cannot send a price at all", async () => {
      const other = await s.product(vendor, { name: 'Other', priceMinor: 5000 });
      const foreign = await addOption(other.id, 'Extra', { required: false, multiple: false }, [['Foreign', -4999]]);
      const c = await s.customer();
      const bad = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0], sauce.values[0], foreign.values[0]] });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.code).toBe('INVALID_OPTION_SELECTION');
      const priced = await add(c, pizza.id, { quantity: 1, selectedOptionValueIds: [size.values[0], sauce.values[0]], unitPriceMinor: 1, priceMinor: 1, totalMinor: 1 });
      expect(priced.status).toBe(400); // whitelist: client-supplied prices are rejected, never trusted
    });
  });
});

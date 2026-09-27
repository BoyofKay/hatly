import { SupportContactController } from './support-contact.controller';

/** Direct controller-instantiation test (repo convention — see vendor-orders.controller.spec.ts). */
describe('SupportContactController', () => {
  const build = (number: string | null) => {
    const businessConfigService = { getCustomerSupportWhatsappNumber: jest.fn(async () => number) };
    return { controller: new SupportContactController(businessConfigService as any), businessConfigService };
  };

  it('returns exactly the support WhatsApp number and nothing else', async () => {
    const { controller } = build('+201000000000');
    await expect(controller.getContact()).resolves.toEqual({ data: { whatsappNumber: '+201000000000' } });
  });

  it('returns whatsappNumber: null (not an error) when no support number is configured', async () => {
    const { controller } = build(null);
    await expect(controller.getContact()).resolves.toEqual({ data: { whatsappNumber: null } });
  });
});

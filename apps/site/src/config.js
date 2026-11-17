/** Contact details used across the whole site. Change them here and every page follows. */
export const SITE = {
  name: 'NTS Transport',
  company: 'NTS Digital Solutions',
  email: 'hello@ntsdigitalsolutions.com',
  phoneDisplay: '+232 31 034 604',
  phoneTel: '+23231034604',
  /** WhatsApp wants the number in international format with digits only. */
  whatsappNumber: '23231034604',
  whatsappMessage:
    'Hello NTS Digital Solutions, I would like to know more about the NTS Transport system.',
};

export const whatsappLink = (text = SITE.whatsappMessage) =>
  `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(text)}`;

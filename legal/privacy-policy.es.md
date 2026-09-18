# Política de Privacidad de Saleslid

**Última actualización: 3 de septiembre de 2026**

> ⚠️ **Nota para el equipo de Saleslid:** este documento es un borrador redactado para cubrir los requisitos habituales de una plataforma SaaS de CRM que integra WhatsApp, Instagram, Google Calendar e inteligencia artificial, y para satisfacer el proceso de verificación de OAuth de Google. No reemplaza el asesoramiento de un abogado. Antes de publicarlo, recomendamos que un abogado ecuatoriano lo revise, en particular en relación con la Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador.

## 1. Quiénes somos

Saleslid ("Saleslid", "nosotros", "nuestro") es una plataforma de CRM (gestión de relación con clientes) para WhatsApp que permite a negocios gestionar conversaciones, contactos, oportunidades de venta, calendarios y respuestas automáticas asistidas por inteligencia artificial.

Si tenés preguntas sobre esta Política de Privacidad o sobre cómo tratamos tus datos, escribinos a **soporte@saleslid.com**.

Esta política aplica a:
- El sitio **saleslid.com**
- La aplicación **app.saleslid.com** (el producto)
- Cualquier otro subdominio o servicio operado por Saleslid

## 2. Qué datos recopilamos

Según cómo uses Saleslid, podemos recopilar:

### 2.1 Datos de tu cuenta
- Nombre completo, correo electrónico, contraseña (almacenada de forma segura, nunca en texto plano)
- Si iniciás sesión con Google: tu nombre, correo electrónico y foto de perfil de Google
- Nombre de tu negocio y rol dentro de tu cuenta (dueño, administrador, agente, visor)

### 2.2 Datos de tus clientes (los contactos de tu negocio)
Cuando usás Saleslid para atender a tus propios clientes por WhatsApp o Instagram, procesamos en tu nombre:
- Números de teléfono y nombres de tus contactos
- El contenido de las conversaciones (mensajes de texto, notas de voz, imágenes, documentos)
- Metadatos de las conversaciones (fecha, hora, estado de entrega)
- Información que vos mismo cargás sobre tus contactos (etiquetas, notas, campos personalizados, oportunidades de venta)

**Importante:** respecto a estos datos de tus propios clientes, actuamos como **encargados del tratamiento** (procesamos los datos en tu nombre y siguiendo tus instrucciones); vos, como negocio que usa Saleslid, sos el **responsable** de esos datos frente a tus propios clientes.

### 2.3 Datos de Google Calendar
Si conectás Google Calendar desde Ajustes → Integraciones, Saleslid accede — con tu autorización explícita a través del proceso de consentimiento de Google — a:
- Los eventos próximos de tu calendario (para que el agente de IA pueda evitar agendar citas encimadas)
- La posibilidad de crear y actualizar eventos en tu calendario cuando se agenda una cita, ya sea manualmente desde la página de Calendario o automáticamente por el agente de IA

**Uso de datos de la API de Google:** el uso y la transferencia por parte de Saleslid de la información recibida de las APIs de Google se ajustará a la [Política de Datos de Usuario de los Servicios de API de Google](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de Uso Limitado ("Limited Use"). En particular:
- Solo usamos los datos de tu Google Calendar para las funcionalidades que vos activaste explícitamente (leer disponibilidad y crear/actualizar eventos)
- No usamos esos datos para publicidad
- No transferimos esos datos a terceros, salvo lo necesario para brindarte el servicio (por ejemplo, nuestro proveedor de infraestructura, descrito más abajo) o cuando la ley lo exige
- Ningún humano de nuestro equipo lee el contenido de tu calendario salvo para brindarte soporte técnico que vos mismo solicitaste, para cumplir obligaciones legales, o por motivos de seguridad

Podés desconectar Google Calendar en cualquier momento desde Ajustes → Integraciones, o revocando el acceso directamente desde tu cuenta de Google en [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Al desconectarlo, dejamos de acceder a tu calendario y eliminamos los tokens de acceso almacenados.

### 2.4 Datos procesados por inteligencia artificial
Si activás las respuestas automáticas con IA, el contenido de las conversaciones (y, si corresponde, un resumen de tu calendario) se envía al proveedor de IA que vos mismo configuraste con tu propia clave de API (OpenAI, Anthropic o OpenRouter) para generar una respuesta. Ese proveedor procesa esos datos según sus propias políticas de privacidad; te recomendamos revisarlas antes de activar esta función.

### 2.5 Datos técnicos
Dirección IP, tipo de navegador, páginas visitadas dentro de la aplicación y registros de uso, con fines de seguridad, prevención de fraude y mejora del servicio.

## 3. Para qué usamos tus datos

- Brindarte el servicio de Saleslid (bandeja de entrada compartida, pipelines de ventas, calendario, automatizaciones, respuestas con IA)
- Autenticarte y mantener segura tu cuenta
- Enviarte comunicaciones operativas (por ejemplo, notificaciones de la plataforma)
- Brindar soporte técnico cuando lo solicitás
- Mejorar y dar mantenimiento a la plataforma
- Cumplir obligaciones legales

No vendemos tus datos personales ni los de tus contactos a terceros.

## 4. Con quién compartimos datos

Para poder ofrecerte el servicio, compartimos datos con:

- **Supabase** (base de datos y autenticación) — aloja tu información de cuenta y los datos operativos de tu CRM
- **Meta / WhatsApp Business Platform, Zernio y/o Dualhook** — para el envío y recepción de mensajes de WhatsApp e Instagram, según la opción de conexión que elijas
- **Google** — únicamente si conectás Google Calendar o iniciás sesión con Google, y solo para las funciones descritas en esta política
- **Tu proveedor de IA elegido** (OpenAI, Anthropic u OpenRouter) — únicamente si activás las respuestas automáticas con IA, usando tu propia clave de API
- Autoridades públicas, cuando la ley así lo exija

Ninguno de estos terceros puede usar tus datos para fines propios distintos de prestarnos el servicio contratado, salvo lo que cada uno de ellos disponga en sus propias políticas (por ejemplo, la de tu proveedor de IA).

## 5. Seguridad

Aplicamos medidas técnicas y organizativas razonables para proteger tus datos, entre ellas:
- Cifrado de credenciales sensibles en reposo (por ejemplo, tokens de WhatsApp y de Google) mediante AES-256
- Control de acceso basado en roles dentro de tu cuenta
- Conexiones cifradas (HTTPS/TLS) entre tu navegador y nuestros servidores

Ningún sistema es 100% seguro; si detectamos un incidente de seguridad que afecte tus datos, te notificaremos según lo exige la ley aplicable.

## 6. Cuánto tiempo conservamos tus datos

Conservamos tus datos mientras tu cuenta esté activa. Si cancelás tu cuenta, eliminamos o anonimizamos tus datos dentro de un plazo razonable, salvo que debamos conservarlos por obligaciones legales, contables o para resolver disputas.

## 7. Tus derechos

De acuerdo con la Ley Orgánica de Protección de Datos Personales de Ecuador y otras normas aplicables, podés solicitarnos:
- Acceder a los datos personales que tenemos sobre vos
- Rectificar datos inexactos
- Eliminar tus datos ("derecho al olvido"), salvo excepciones legales
- Oponerte u limitar ciertos usos de tus datos
- Revocar tu consentimiento en cualquier momento (por ejemplo, desconectando Google Calendar)

Para ejercer estos derechos, escribinos a **soporte@saleslid.com**.

## 8. Menores de edad

Saleslid no está dirigido a menores de edad y no recopilamos intencionalmente datos de personas menores de 18 años.

## 9. Cambios a esta política

Podemos actualizar esta Política de Privacidad ocasionalmente. Publicaremos la fecha de la última actualización en la parte superior de este documento; si los cambios son significativos, te lo notificaremos por correo electrónico o dentro de la aplicación.

## 10. Contacto

Saleslid
Correo: **soporte@saleslid.com**

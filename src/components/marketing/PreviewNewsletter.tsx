import { Card } from "@/components/ui/card";
import { TipoNewsletter } from "./SelectorTipoNewsletter";

interface PreviewNewsletterProps {
  tipo: TipoNewsletter | null;
  titulo: string;
  mensaje: string;
  imagenUrl?: string;
}

const plantillaAnuncio = (titulo: string, mensaje: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 0 auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
    .header { background-color: #363e45; padding: 30px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; color: #ffffff; font-size: 26px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
    .brand-subtitle { color: #c49a6c; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; margin-top: 5px; display: block; }
    .content { padding: 40px; line-height: 1.8; font-size: 16px; color: #363e45; }
    .footer { background-color: #f9f9f9; padding: 20px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; }
    a { color: #363e45; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <span class="brand-subtitle">Comunicado Oficial</span>
    </div>
    <div class="content">
      <h2 style="color: #c49a6c; margin-top: 0; font-family: 'Georgia', serif;">${titulo || 'Título del anuncio'}</h2>
      <p style="white-space: pre-line;">${mensaje || 'El mensaje aparecerá aquí...'}</p>
      <p style="margin-top: 30px; font-style: italic;">
        Atentamente,<br>
        <strong>La Dirección de Casa Tomás</strong>
      </p>
    </div>
    <div class="footer">
      <p>C/ Santa María de la Cabeza, 2, Crevillente | Tel: 966 10 78 87</p>
      <p><a href="#">Dejar de recibir estos avisos</a></p>
    </div>
  </div>
</body>
</html>
`;

const plantillaNuevoMenu = (titulo: string, mensaje: string, imagenUrl?: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 0 auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); border-top: 5px solid #c49a6c; }
    .header { background-color: #ffffff; padding: 40px 20px 20px; text-align: center; border-bottom: 1px solid #f0f0f0; }
    .brand-name { font-family: 'Georgia', serif; color: #363e45; font-size: 28px; margin: 0; text-transform: uppercase; }
    .content { padding: 40px; line-height: 1.6; }
    .menu-box { background-color: #fffcf5; border: 1px solid #eaddcf; padding: 30px; margin: 20px 0; text-align: center; }
    .menu-title { color: #c49a6c; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; margin-bottom: 20px; display: block; }
    .menu-text { white-space: pre-line; color: #555; font-style: italic; font-size: 16px; line-height: 2; }
    .btn-gold { display: inline-block; background-color: #363e45; color: #fff !important; padding: 12px 30px; text-decoration: none; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 13px; margin-top: 20px; }
    .footer { background-color: #363e45; padding: 30px; font-size: 12px; color: #aaa; text-align: center; }
    .footer a { color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <p style="color: #999; text-transform: uppercase; font-size: 11px; letter-spacing: 2px; margin-top: 5px;">Gastronomía & Tradición</p>
    </div>
    <div class="content">
      ${imagenUrl ? `<img src="${imagenUrl}" style="width: 100%; height: auto; display: block; margin-bottom: 30px; border-radius: 2px;">` : ''}
      <h2 style="text-align: center; color: #363e45; margin-bottom: 10px;">${titulo || 'Título del menú'}</h2>
      <div class="menu-box">
        <span class="menu-title">Propuesta Gastronómica</span>
        <div class="menu-text">${mensaje || 'El mensaje aparecerá aquí...'}</div>
      </div>
      <div style="text-align: center;">
        <a href="#" class="btn-gold">Reservar Mesa</a>
      </div>
    </div>
    <div class="footer">
      <p>Casa Tomás Crevillente</p>
      <p><a href="#">Darse de baja</a></p>
    </div>
  </div>
</body>
</html>
`;

const plantillaOferta = (titulo: string, mensaje: string, imagenUrl?: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #222; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .container { background-color: #ffffff; max-width: 600px; margin: 0 auto; }
    .hero { background-color: #363e45; color: #ffffff; padding: 40px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; font-size: 24px; margin-bottom: 20px; display: block; }
    .offer-badge { display: inline-block; background-color: #c49a6c; color: #fff; padding: 5px 15px; text-transform: uppercase; font-size: 12px; font-weight: bold; letter-spacing: 1px; margin-bottom: 15px; }
    .content { padding: 40px; text-align: center; }
    .btn-cta { display: inline-block; background-color: #c49a6c; color: #ffffff !important; padding: 15px 40px; text-decoration: none; font-size: 18px; font-weight: bold; border-radius: 4px; margin-top: 20px; box-shadow: 0 4px 10px rgba(196, 154, 108, 0.4); }
    .footer { background-color: #f4f4f4; padding: 20px; font-size: 11px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    ${imagenUrl ? `<img src="${imagenUrl}" style="width: 100%; height: auto; display: block;" alt="Oferta Especial">` : '<div style="height: 200px; background: linear-gradient(135deg, #363e45, #c49a6c); display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 48px;">🎉</span></div>'}
    <div class="hero">
      <span class="brand-name">Casa Tomás</span>
      <h1 style="margin: 0; font-size: 28px; line-height: 1.2;">${titulo || 'Título de la oferta'}</h1>
    </div>
    <div class="content">
      <span class="offer-badge">Promoción Exclusiva</span>
      <p style="font-size: 18px; color: #555; line-height: 1.6; margin-bottom: 30px;">${mensaje || 'El mensaje aparecerá aquí...'}</p>
      <a href="#" class="btn-cta">APROVECHAR OFERTA</a>
    </div>
    <div class="footer">
      <p>Oferta válida según disponibilidad.</p>
      <p><a href="#" style="color: #888;">No quiero recibir más ofertas</a></p>
    </div>
  </div>
</body>
</html>
`;

export function PreviewNewsletter({ tipo, titulo, mensaje, imagenUrl }: PreviewNewsletterProps) {
  if (!tipo) {
    return (
      <Card className="h-full flex items-center justify-center bg-muted/30 min-h-[500px]">
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            Selecciona un tipo de newsletter para ver la preview
          </p>
        </div>
      </Card>
    );
  }

  const getHtmlTemplate = () => {
    switch (tipo) {
      case 'anuncio':
        return plantillaAnuncio(titulo, mensaje);
      case 'nuevo_menu':
        return plantillaNuevoMenu(titulo, mensaje, imagenUrl);
      case 'oferta':
        return plantillaOferta(titulo, mensaje, imagenUrl);
      default:
        return '';
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/30 p-2 text-center text-xs text-muted-foreground border-b">
        Vista previa del email
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <iframe
          srcDoc={getHtmlTemplate()}
          className="w-full min-h-[550px] border-0"
          title="Email Preview"
          sandbox="allow-same-origin"
        />
      </div>
    </Card>
  );
}

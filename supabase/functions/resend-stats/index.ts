import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Fetching Resend email statistics...');

    // Fetch emails from Resend API directly
    const response = await fetch('https://api.resend.com/emails', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return new Response(
        JSON.stringify({ error: errorData.message || 'Error fetching emails' }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const emails = await response.json();
    console.log(`Fetched ${emails?.data?.length || 0} emails from Resend`);

    // Initialize counters
    const stats = {
      total: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
    };

    // Count by last_event status
    if (emails?.data) {
      stats.total = emails.data.length;
      
      for (const email of emails.data) {
        const lastEvent = email.last_event;
        
        switch (lastEvent) {
          case 'sent':
            stats.sent++;
            break;
          case 'delivered':
            stats.delivered++;
            break;
          case 'opened':
            stats.opened++;
            break;
          case 'clicked':
            stats.clicked++;
            break;
          case 'bounced':
            stats.bounced++;
            break;
          case 'complained':
            stats.complained++;
            break;
          default:
            // Count as sent if no specific event
            stats.sent++;
        }
      }
    }

    // Calculate rates
    const rates = {
      deliveryRate: stats.total > 0 ? ((stats.delivered + stats.opened + stats.clicked) / stats.total * 100).toFixed(1) : '0',
      openRate: stats.total > 0 ? ((stats.opened + stats.clicked) / stats.total * 100).toFixed(1) : '0',
      clickRate: stats.total > 0 ? (stats.clicked / stats.total * 100).toFixed(1) : '0',
      bounceRate: stats.total > 0 ? (stats.bounced / stats.total * 100).toFixed(1) : '0',
    };

    const result = {
      stats,
      rates,
      lastUpdated: new Date().toISOString(),
    };

    console.log('Statistics calculated:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching Resend stats:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

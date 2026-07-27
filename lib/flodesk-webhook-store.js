const { getSupabaseClient } = require('./supabase-client');

async function logSubscriberEvent({ eventType, subscriberId, email, eventTime }) {
  const { error } = await getSupabaseClient()
    .from('flodesk_subscriber_events')
    .insert({ event_type: eventType, subscriber_id: subscriberId, email, event_time: eventTime });
  if (error) throw error;
}

async function countSubscriberEvents({ eventType, startDate, endDate }) {
  const { count, error } = await getSupabaseClient()
    .from('flodesk_subscriber_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', eventType)
    .gte('event_time', startDate)
    .lt('event_time', endDate);
  if (error) throw error;
  return count || 0;
}

// The earliest event of this type we've ever logged -- a figure for period X
// is only meaningful if we were already tracking before X started, since
// tracking only begins once the webhook is registered (there's no
// historical backfill from Flodesk's API).
async function getEarliestTrackedEventTime(eventType) {
  const { data, error } = await getSupabaseClient()
    .from('flodesk_subscriber_events')
    .select('event_time')
    .eq('event_type', eventType)
    .order('event_time', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data.event_time : null;
}

module.exports = { logSubscriberEvent, countSubscriberEvents, getEarliestTrackedEventTime };

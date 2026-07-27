const { getSupabaseClient } = require('./supabase-client');

async function logUnsubscribeEvent({ subscriberId, email, eventTime }) {
  const { error } = await getSupabaseClient()
    .from('flodesk_unsubscribe_events')
    .insert({ subscriber_id: subscriberId, email, event_time: eventTime });
  if (error) throw error;
}

async function countUnsubscribeEvents({ startDate, endDate }) {
  const { count, error } = await getSupabaseClient()
    .from('flodesk_unsubscribe_events')
    .select('id', { count: 'exact', head: true })
    .gte('event_time', startDate)
    .lt('event_time', endDate);
  if (error) throw error;
  return count || 0;
}

// The earliest event we've ever logged -- churn figures for periods before
// this date are meaningless (tracking hadn't started yet), so callers use
// this to decide whether to show a real number or a "not tracked yet" note.
async function getEarliestTrackedEventTime() {
  const { data, error } = await getSupabaseClient()
    .from('flodesk_unsubscribe_events')
    .select('event_time')
    .order('event_time', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data.event_time : null;
}

module.exports = { logUnsubscribeEvent, countUnsubscribeEvents, getEarliestTrackedEventTime };

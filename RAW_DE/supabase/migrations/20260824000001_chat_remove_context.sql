-- Objekt-/Tourbezug ist im Chat nicht Bestandteil des Funktionsumfangs.
alter table public.chat_messages
  drop column if exists object_id,
  drop column if exists tour_id;

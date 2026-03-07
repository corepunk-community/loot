#!/usr/bin/env ruby
# compare_data.rb - Compare binary game file data vs corepunk.help API data
require "json"

meta = JSON.parse(File.read("quest_metadata_v0.98.1.json"))
api_data = JSON.parse(File.read("api_quests_v0.98.1.json"))
rewards = JSON.parse(File.read("quest_rewards_v0.98.1.json"))
slug_map = api_data["slugMap"] || {}

api_quests = {}
(api_data["quests"] || api_data).each { |q| api_quests[q["slug"]] = q }

def to_slug(name)
  name.downcase.gsub(/[^a-z0-9\s-]/, "").gsub(/\s+/, "-").strip
end

puts "=" * 70
puts "DATA COMPARISON: Binary Game Files vs corepunk.help API"
puts "=" * 70

# --- Coverage ---
puts "\n## COVERAGE"
puts "Binary quest metadata entries: #{meta.size}"
puts "API quest entries: #{api_quests.size}"
puts "Binary quest rewards (with items): #{rewards.size}"

# Overlap using slug matching
binary_slugs = meta.keys.map { |k| k.gsub("_", "-") }
api_slugs = api_quests.keys
both = binary_slugs & api_slugs
only_binary = binary_slugs - api_slugs
only_api = api_slugs - binary_slugs

# Also check slug map matches
slug_map.each do |bin_slug, api_slug|
  if only_binary.include?(bin_slug) && api_slugs.include?(api_slug)
    only_binary.delete(bin_slug)
    both << bin_slug unless both.include?(bin_slug)
  end
end

puts "\nQuests in both: #{both.size}"
puts "Only in binary: #{only_binary.size}"
puts "Only on API: #{only_api.size}"

# --- Quest Giver Comparison ---
puts "\n## QUEST GIVER COMPARISON (quests in both sources)"
giver_match = 0
giver_diff = 0
giver_only_binary = 0
giver_only_api = 0
giver_neither = 0
diffs = []

both.each do |slug|
  api_slug = slug_map[slug] || slug
  api_q = api_quests[api_slug] || api_quests[slug]
  meta_id = slug.gsub("-", "_")
  bin_q = meta[meta_id]
  next unless bin_q && api_q

  bin_giver = bin_q["questGiver"]
  api_giver = api_q.dig("questGiver", "name")

  has_bin = bin_giver && !bin_giver.empty?
  has_api = api_giver && !api_giver.empty?

  if has_bin && has_api
    bn = bin_giver.downcase.gsub(/[^a-z0-9]/, "")
    an = api_giver.downcase.gsub(/[^a-z0-9]/, "")
    if bn == an || an.include?(bn) || bn.include?(an)
      giver_match += 1
    else
      giver_diff += 1
      diffs << { quest: bin_q["name"], binary: bin_giver, api: api_giver }
    end
  elsif has_bin
    giver_only_binary += 1
  elsif has_api
    giver_only_api += 1
  else
    giver_neither += 1
  end
end

puts "Givers match: #{giver_match}"
puts "Givers differ: #{giver_diff}"
puts "Only in binary: #{giver_only_binary}"
puts "Only on API: #{giver_only_api}"
puts "Neither has giver: #{giver_neither}"

if diffs.any?
  puts "\nGiver differences (#{diffs.size}):"
  diffs.each do |d|
    puts "  #{d[:quest]}"
    puts "    Binary: #{d[:binary]}"
    puts "    API:    #{d[:api]}"
  end
end

# --- Location Comparison ---
puts "\n## LOCATION/REGION COMPARISON"
loc_match = 0
loc_diff = 0
loc_diffs = []
loc_only_binary = 0
loc_only_api = 0

both.each do |slug|
  api_slug = slug_map[slug] || slug
  api_q = api_quests[api_slug] || api_quests[slug]
  meta_id = slug.gsub("-", "_")
  bin_q = meta[meta_id]
  next unless bin_q && api_q

  bin_region = bin_q["region"]
  api_loc = api_q["location"]

  has_bin = bin_region && !bin_region.empty?
  has_api = api_loc && !api_loc.empty?

  if has_bin && has_api
    bn = bin_region.downcase.gsub(/[^a-z0-9]/, "")
    an = api_loc.downcase.gsub(/[^a-z0-9]/, "")
    if bn == an || an.include?(bn) || bn.include?(an)
      loc_match += 1
    else
      loc_diff += 1
      loc_diffs << { quest: bin_q["name"], binary: bin_region, api: api_loc }
    end
  elsif has_bin
    loc_only_binary += 1
  elsif has_api
    loc_only_api += 1
  end
end

puts "Regions match: #{loc_match}"
puts "Regions differ: #{loc_diff}"
puts "Only in binary: #{loc_only_binary}"
puts "Only on API: #{loc_only_api}"

if loc_diffs.any?
  puts "\nRegion differences (#{loc_diffs.size}):"
  loc_diffs.each do |d|
    puts "  #{d[:quest]}: Binary=\"#{d[:binary]}\" vs API=\"#{d[:api]}\""
  end
end

# --- Chain/Prerequisite Comparison ---
puts "\n## CHAIN LINK COMPARISON"
bin_chains = 0
api_chains = 0
meta.each do |id, q|
  bin_chains += 1 if q["nextQuests"] || q["prevQuests"]
end
api_quests.each do |slug, q|
  prereqs = q["prerequisiteQuests"] || []
  api_chains += 1 if prereqs.any?
end
puts "Quests in chains (binary next_quest links): #{bin_chains}"
puts "Quests with prerequisites (API): #{api_chains}"

# Check binary chain links that match API prereqs
chain_match = 0
chain_diff = 0
chain_details = []

meta.each do |id, q|
  next unless q["nextQuests"]
  slug = id.gsub("_", "-")
  q["nextQuests"].each do |next_id|
    next_slug = next_id.gsub("_", "-")
    next_api = api_quests[next_slug]
    if next_api
      prereqs = (next_api["prerequisiteQuests"] || [])
      api_slug = slug_map[slug] || slug
      if prereqs.include?(slug) || prereqs.include?(api_slug)
        chain_match += 1
      else
        chain_diff += 1
        chain_details << "#{q["name"]} -> #{next_id} (API prereqs: #{prereqs.join(", ")})"
      end
    end
  end
end

puts "\nBinary chain links confirmed by API prereqs: #{chain_match}"
puts "Binary chain links NOT in API prereqs: #{chain_diff}"
if chain_details.any?
  puts "\nUnconfirmed chain links:"
  chain_details.first(15).each { |d| puts "  #{d}" }
  puts "  ... (#{chain_details.size - 15} more)" if chain_details.size > 15
end

# --- Goals Comparison ---
puts "\n## GOALS COMPARISON"
goals_both = 0
goals_only_binary = 0
goals_only_api = 0

both.each do |slug|
  api_slug = slug_map[slug] || slug
  api_q = api_quests[api_slug] || api_quests[slug]
  meta_id = slug.gsub("-", "_")
  bin_q = meta[meta_id]
  next unless bin_q && api_q

  has_bin = bin_q["goals"] && bin_q["goals"].any?
  has_api = api_q["goals"] && api_q["goals"].any?

  if has_bin && has_api
    goals_both += 1
  elsif has_bin
    goals_only_binary += 1
  elsif has_api
    goals_only_api += 1
  end
end

puts "Goals in both: #{goals_both}"
puts "Goals only in binary: #{goals_only_binary}"
puts "Goals only on API: #{goals_only_api}"

# --- Data unique to each source ---
puts "\n## UNIQUE DATA PER SOURCE"
puts "\nBinary-only data:"
puts "  Quest giver names from localization XMLs (#{giver_only_binary} quests with giver not on API)"
puts "  Detailed location (e.g. \"Goldenfield, Distant Farm\" vs just \"Goldenfield Town\")"
puts "  Location codes (GLFD, STEP, etc.) for all 972 quests"
puts "  next_quest chain links from binary quest files"

puts "\nAPI-only data:"
puts "  Quest levels (#{api_quests.count { |_, q| q["level"] }} quests with level)"
puts "  NPC slugs for clickable map links"
puts "  Quest finisher NPCs"
puts "  Richer goal descriptions with quantities and target items"

# --- Quests only in binary (not on API) ---
puts "\n## QUESTS ONLY IN BINARY (#{only_binary.size})"
only_binary.sort.first(20).each do |slug|
  meta_id = slug.gsub("-", "_")
  q = meta[meta_id]
  next unless q
  giver = q["questGiver"] || "?"
  region = q["region"] || "?"
  puts "  #{q["name"]} — #{giver}, #{region}"
end
puts "  ... (#{only_binary.size - 20} more)" if only_binary.size > 20

# --- Quests only on API (not in binary) ---
puts "\n## QUESTS ONLY ON API (#{only_api.size})"
only_api.sort.first(20).each do |slug|
  q = api_quests[slug]
  next unless q
  level = q["level"] ? "Lv#{q["level"]}" : "?"
  loc = q["location"] || "?"
  puts "  #{q["name"]} (#{slug}) — #{level}, #{loc}"
end
puts "  ... (#{only_api.size - 20} more)" if only_api.size > 20

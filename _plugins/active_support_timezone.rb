# Adopt the Rails 8 timezone behavior before Jekyll evaluates date filters.
require "active_support"

ActiveSupport.to_time_preserves_timezone = true

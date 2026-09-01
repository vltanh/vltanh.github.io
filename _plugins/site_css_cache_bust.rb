module Jekyll
  module SiteCssCacheBust
    require "digest/md5"

    def bust_site_css_cache(file_name)
      site_source = @context.registers[:site].source
      stylesheet_paths = [File.join(site_source, "assets/css/main.scss")]
      stylesheet_paths.concat(Dir[File.join(site_source, "_sass/**/*.scss")].sort)

      digest = Digest::MD5.new
      stylesheet_paths.each { |path| digest << File.binread(path) }
      "#{file_name}?v=#{digest.hexdigest}"
    end
  end
end

Liquid::Template.register_filter(Jekyll::SiteCssCacheBust)

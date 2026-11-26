# Resolve react_native_pods.rb with node to allow for hoisting
require Pod::Executable.execute_command('node', ['-p',
  'require.resolve(
    "react-native/scripts/react_native_pods.rb",
    {paths: [process.argv[1]]},
  )', __dir__]).strip

platform :ios, min_ios_version_supported
prepare_react_native_project!

linkage = ENV['USE_FRAMEWORKS']
if linkage != nil
  Pod::UI.puts "Configuring Pod with #{linkage}ally linked Frameworks".green
  use_frameworks! :linkage => linkage.to_sym
end

target 'Sommet' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    # An absolute path to your application root.
    :app_path => __dir__
  )

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      # :ccache_enabled => true
    )

    # Some pod resource bundles still declare older targets that Xcode 27 rejects.
    minimum_ios = Gem::Version.new(min_ios_version_supported)
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |configuration|
        target = configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if target && Gem::Version.correct?(target) && Gem::Version.new(target) < minimum_ios
          configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
        end
      end
    end
  end
end

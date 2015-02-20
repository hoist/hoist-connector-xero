ssh-add
git submodule add git@github.com:hoist/deploy.git
cd deploy && bundle install
REPOSITORY='hoist-connector-xero' CIRCLE_PROJECT_USERNAME='hoist' bundle exec cap executor_servers deploy
cd ../
git rm -rf deploy
git rm .gitmodules -f
rm -rf .git/modules/deploy

FROM quay.io/hoist/core-box

USER root
#copy npmrc to enable login to private npm
COPY .npmrc /home/hoist/.npmrc

RUN chown hoist:hoist /home/hoist/.npmrc

USER hoist

#npm install
ADD package.json /usr/src/app/package.json
RUN npm install

RUN rm /home/hoist/.npmrc

#ensure migrations run from correct directory
ENV NODE_MONGOOSE_MIGRATIONS_CONFIG=./config/migrations.js

#ensure nodemon doesn't create heapdumps
ENV NODE_HEAPDUMP_OPTIONS=nosignal

#add source and ensure it's owned by the hoist user
USER root
ADD . /usr/src/app
RUN chown -R hoist:hoist /usr/src/app
USER hoist

#start the deploy script
CMD [ "./deploy.sh"]

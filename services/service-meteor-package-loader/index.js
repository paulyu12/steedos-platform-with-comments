"use strict";

const objectql = require('@steedos/objectql');
const triggerLoader = require('./lib').triggerLoader;
const path = require('path');
const Future = require('fibers/future');
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
    name: "service-meteor-package-loader",

    /**
     * Settings
     */
    settings: {
        path: '', // 扫描加载原数据的路径
        name: '' // service name
    },

    /**
     * Dependencies
     */
    dependencies: ['metadata-server'],

    /**
     * Actions
     */
    actions: {

    },

    /**
     * Events
     */
    events: {

    },

	/**
	 * Methods
	 */
	methods: {
		loadPackageMetadataFiles: async function (packagePath, name) {
			await Future.task(async () => {
				let steedosSchema = objectql.getSteedosSchema(this.broker);
				steedosSchema.addMeteorDatasource();
                const datasourceName = 'meteor';
				packagePath = path.join(packagePath, '**');
                const datasource = objectql.getDataSource(datasourceName);
                await datasource.init();
				await objectql.loadStandardMetadata(name, datasourceName);

                // yupeng: 对所有软件包中元数据，为他们生成对应 Type 对象在内存中
                await objectql.addAllConfigFiles(packagePath, datasourceName, name);
				await triggerLoader.load(this.broker, packagePath, name);
				return;
			}).promise();
		}
	},

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.logger.debug('service package loader created!!!');
    },

    merged (schema) {
        schema.name = `~packages-${schema.name}`;
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {
        console.time(`service ${this.name} started`)
        let packageInfo = this.settings.packageInfo;
        if (!packageInfo) {
            return;
        }
        const { path } = packageInfo;
        if (!path) {
            this.logger.info(`Please config packageInfo in your settings.`);
            console.log(`service ${this.name} started`);
            return;
        }

        // yupeng: 加载标准元数据（包括 db 中的元数据入 redis），加载 trigger
        await this.loadPackageMetadataFiles(path, this.name);
        console.timeEnd(`service ${this.name} started`)
        // console.log(`service ${this.name} started`);
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        await this.broker.call(`metadata.refreshServiceMetadatas`, {offlinePackageServices: [this.name]});
    }
};

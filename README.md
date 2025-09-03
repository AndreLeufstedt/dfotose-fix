
DFotos hemsida
===============

*Versionsnummer*: v2

Detta är koden till Datateknologsektionens fotoförenings, hemsida.

För att få inloggning(kerberos) att fungera i fixa krb5.conf såhär: http://dtek.se/wiki/Main/Kerberos.
Detta behöver endast göras server-side.

### Requirements
Installera

* node/nodejs
* gulp
* kerberos config

### Fetch & Build
```bash
$> git clone https://github.com/dtekcth/dfotose
$> cd dfotose
$> npm install
...
$> cp src/config/config.yml{.sample,}
$> vim src/config/config.yml
...
$> gulp server:build
$> gulp
...
```

Besök sidan på http://localhost:4000/ . När du ändrar i koden laddar den om sig själv by default.


### Docker
Du kan lätt få upp sidan genom att använda docker.

Först behöver du klona repot, och skapa en config-fil, se till att ändra session-secret till något gött
och bra långt!

```bash
$> git clone https://github.com/dtekcth/dfotose
$> cd dfotose
...
$> cp src/config/config.yml{.sample,}
$> vim src/config/config.yml
...
```

När du satt upp det behöver du installera både `docker` och `docker-compose`, googla om du inte vet hur.
Efter detta är det lätt att slänga igång sidan:

```bash
$> docker-compose build
...
```

För att starta sidan i en produktionsmiljö, kör:

```bash
$> make up-prod
...
```

För att starta den i en utvecklingsmiljö, kör:

```bash
$> make up-dev
...
```

Sidan borde starta tillsammans med mongodb och redis i bakgrunden. Om det är en första gången setup (vilket det oftast är, annars ändra
`docker-compose.yml` till att peka mot andra docker containers) så behöver du ge en första
person admin access på sidan. Gör detta genom att öppna en mongo-client (e.g. `docker exec -it dfotose_mongo_1 mongo`)
och sedan slänga in `{ cid: '<ditt cid>, role: 'Admin' }` i `usereligibleforrole` tabellen.

Sidan exponeras på port 4000 by default, vilket går att ändra i `docker-compose.yml`.


### REST api

DFoto har ett öppet rest-liknande api för att kunna hämta bilder och gallerier. All data returneras formaterad som json.

**notera**: alla paths prefixas med ett versionsnummer. Se versionsnummret i readme-filen.

> Exempel: /gallery => /v1/gallery



| Method | Path                           | Description                              |
| ------ | ------------------------------ | ---------------------------------------- |
| GET    | /gallery                       | list of all galleries sorted in descending order |
| GET    | /gallery/limit/:limit          | list of all galleries with a maximum limit |
| GET    | /gallery/count                 | the count of all galleries               |
| GET    | /gallery/:id                   | get the data of a specific gallery       |
| GET    | /gallery/:id/thumbnail-preview | the actual thumbnail image of a gallery  |
| GET    | /image/:galleryId              | list of all images in a specific gallery |
| GET    | /image/:id/fullSize            | the actual full-size image               |
| GET    | /image/:id/thumbnail           | the actual thumbnail image               |
| GET    | /image/:id/preview             | the preview image                        |
| GET    | /image/:id/tags                | all the tags associated with an image    |
| GET    | /image/tags/:name/search       | a list of images that contains a certain tag |
| GET    | /stats/photos                  | get the amount of pictures on the site   |

*AI-notering*: Detta projekts fortsatt utveckling har delvis utvecklats med hjälp av AI-assistans (Claude) för kodgenerering, felsökning och optimering. All genererad kod har granskats och anpassats innan implementation.


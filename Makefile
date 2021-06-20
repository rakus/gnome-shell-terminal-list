#
# Makefile for term-list
#
# Configuration is via src/metadata.json
# Used entries:
#   - uuid
#   - version
#   - minor_version (optional)
#
# Requires GNU make
#

ROOT_DIR := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

# Phony targets represents recipes, not files
.PHONY: help zip html clean  install diff_installed check

# extract data from metadata.json
EXT_UUID       := $(shell grep '"uuid"' src/metadata.json  | cut -d: -f2 | tr -d '" ,')
EXT_NAME       := $(firstword $(subst @, ,$(EXT_UUID)))
EXT_VERSION    := $(shell grep '"version":' src/metadata.json | tr -dc .0-9 )
EXT_MINVERSION := $(shell grep '"minor_version"' src/metadata.json  | cut -d: -f2 | tr -d '" ,')
ifneq "${EXT_MINVERSION}" ""
	EXT_MINVERSION := .${EXT_MINVERSION}
endif

EXT_ZIP        := ${EXT_NAME}-v${EXT_VERSION}${EXT_MINVERSION}.zip
LOCAL_EXT_INST_DIR = ${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}

JAVASCRIPT := $(wildcard src/*.js)
METADATA   := src/metadata.json
CSS        := $(wildcard src/*.css)
SRC_FILES  := ${JAVASCRIPT} ${METADATA} ${CSS}
SCHEMAS    := $(wildcard src/schemas/*.xml)

GSCHEMAS   := src/schemas/gschemas.compiled

ZIP_CONTENT := ${SRC_FILES} ${GSCHEMAS}

ESLINT_AVAILABLE := $(shell npx --no-install eslint  2> /dev/null && echo "GOT IT")
JSONPP_AVAILABLE := $(shell which json_pp 2> /dev/null)

all: check zip                           ## Run 'check' and 'zip'

zip: ${EXT_ZIP}                          ## Build gnome shell extension installable zip

check:                                   ## Run checks (json_pp, eslint)
ifdef JSONPP_AVAILABLE
	json_pp < ${METADATA} >/dev/null
else
	@echo "WARNING: json_pp not available, metadata.json not validated"
endif
ifdef ESLINT_AVAILABLE
	npx --no-install eslint -f unix ${JAVASCRIPT}
else
	@echo "WARNING: eslint not available, no static code check"
endif

${EXT_ZIP}: ${ZIP_CONTENT}
	@rm -f $@
	@(cd src && zip ../$@ ${ZIP_CONTENT:src/%=%})

html: README.html                        ## Create HTML from markdown files for review

README.html: README.md

%.html: %.md
	marked --gfm --tables -o $@ $^

install: ${ZIP_CONTENT} check            ## Install/update the extension locally
	@mkdir -p ${LOCAL_EXT_INST_DIR}
	@(cd src && cp -vf --parent ${ZIP_CONTENT:src/%=%} "${LOCAL_EXT_INST_DIR}")

${GSCHEMAS}: ${SCHEMAS}
	glib-compile-schemas --strict src/schemas

diff_installed:                         ## Diff agains locally installed extension
	@diff -x '*.sh' -x '*~' -x 'org.gnome.shell.extensions.*.gschema.xml' -r ${LOCAL_EXT_INST_DIR} src/

clean:                                  ## Clean up
	rm -rf ${EXT_NAME}-v*.zip *.html ${GSCHEMAS}

help:                                   ## Prints targets with help text
	@cat $(MAKEFILE_LIST) | grep -E '^[a-zA-Z_-]+:.*?## .*$$' | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%s\033[0m\n    %s\n", $$1, $$2}'

